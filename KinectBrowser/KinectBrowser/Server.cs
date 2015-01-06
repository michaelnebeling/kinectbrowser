using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.IO;
using System.Text;
using Microsoft.Speech.AudioFormat;
using Microsoft.Speech.Recognition;
using Microsoft.Speech.Recognition.SrgsGrammar;
using Microsoft.Kinect;
using Microsoft.Kinect.Toolkit.Interaction;
using Fleck;
using Newtonsoft.Json;


namespace KinectBrowser
{
	// Enable grip and press recognition
	public class InteractionClient : IInteractionClient
	{
		public InteractionInfo GetInteractionInfoAtLocation(int skeletonTrackingId, InteractionHandType handType, double x, double y)
		{
			return new InteractionInfo
			{
				IsPressTarget = true,
				IsGripTarget = true,
			};
		}
	}

	class Server
	{

		// Is Server running?
		private static bool isRunning = true;

		// Kinect
		private static KinectSensor sensor;
		private static Skeleton[] skeletons;					// Skeleton data array
		private static DepthImagePixel[] depthPixels;			// Depth data array
		private static InteractionStream interactionStream;
		private static SpeechRecognitionEngine speechEngine;
		private const double confidenceThreshold = 0.3;			// for speech recognition
		private static TransformSmoothParameters smoothingParameters = new TransformSmoothParameters
		{
			Smoothing = 0.7f,
			Correction = 0.1f,
			Prediction = 0.5f,
			JitterRadius = 0.1f,
			MaxDeviationRadius = 0.04f,
		};			

		// ID of tracked skeleton
		private static int tracked;

		// Area around Kinect origin where pointers are tracked
		// (2*maxDeviation) x (2*maxDeviation)
		private const float maxDeviation = 0.25f;

		// Index-to-hand mapping
		// 0		1
		// left		right
		private static string[] handType = { "left", "right" };

		// History for pointer data (timestamp -> left and right hand joint)
		private class OrderedDictionary<TKey, TValue>
		{	
			// Key-value-storage (timestamp -> left and right hand joint)
			private readonly Dictionary<TKey, TValue> dictionary = new Dictionary<TKey, TValue>();
			// Ordered list of all timestamps, enables indexed access to values
			private readonly List<TKey> list = new List<TKey>();

			public void Add(TKey key, TValue value)
			{
				if (!dictionary.ContainsKey(key))
					list.Add(key);

				dictionary[key] = value;
			}

			public bool TryGetValue(TKey key, out TValue value)
			{
				return dictionary.TryGetValue(key, out value);
			}

			public TKey GetOldestKey()
			{
				return list.ElementAt(0);
			}

			public void RemoveOldest()
			{
				TKey oldest = list.ElementAt(0);
				if (oldest != null)
				{
					dictionary.Remove(oldest);
					list.RemoveAt(0);
				}
			}
			public int Length()
			{
				return list.Count;
			}

			public void Clear()
			{
				dictionary.Clear();
				list.Clear();
			}
		}
		// Gesture recognition
		private static OrderedDictionary<long, Joint[]> history = new OrderedDictionary<long, Joint[]>();
		private const int maxHistoryLength = 9;								// 8 plus current frame
		private const long timeframe = (maxHistoryLength * 1000) / 30;		// 9 frames / 30 fps = 0.3 s timeframe
		private static long lastRecognition = 0;							// timestamp of last recognized gesture

		// WebSockets
		private static IWebSocketConnection activeSocket;

		static void Main(string[] args)
		{
			// Debugging
			FleckLog.Level = LogLevel.Debug;

			// Quit server application (isRunning = false)
			AppDomain.CurrentDomain.ProcessExit += new EventHandler(ProcessExit);				// close
			Console.CancelKeyPress += new ConsoleCancelEventHandler(CancelKeyPressHandler);		// cancel

			SetupWebSocketServer();
			StartKinectSensor();

			while (isRunning) {}
		}

		static void ProcessExit(object sender, EventArgs e)
		{
			CleanUp();
		}

		private static void CancelKeyPressHandler(object sender, ConsoleCancelEventArgs args)
		{
			CleanUp();
		}

		private static void CleanUp()
		{
			// Close open socket
			if (activeSocket != null)
				activeSocket.Close();

			// Release Kinect sensor
			if (sensor != null)
			{
				sensor.AudioSource.Stop();	// stop speech recognition
				sensor.Stop();				// stop Kinect tracking
			}

			FleckLog.Info("Kinect sensor stopped");

			isRunning = false;
		}


		private static void SetupWebSocketServer()
		{
			new WebSocketServer("ws://localhost:8181").Start(socket =>
			{
				socket.OnOpen = () =>
				{
					if (activeSocket != null)		// close previous active sockets
						activeSocket.Close();
					activeSocket = socket;			// save active socket
				};

				socket.OnClose = () => {};

				socket.OnMessage = message => {};	// no client messages
			});
		}

		private static void StartKinectSensor()
		{
			// Try to get first or default Kinect sensor
			sensor = KinectSensor.KinectSensors.FirstOrDefault(s => s.Status == KinectStatus.Connected);

			if (sensor != null)
			{
				// Enable skeleton tracking
				sensor.SkeletonStream.Enable(smoothingParameters);
				sensor.SkeletonStream.TrackingMode = SkeletonTrackingMode.Seated;
				// Allocate skeleton array and add event to process skeleton data
				skeletons = new Skeleton[sensor.SkeletonStream.FrameSkeletonArrayLength];
				sensor.SkeletonFrameReady += SkeletonFrameReady;

				// Enable depth information
				sensor.DepthStream.Enable();
				// Allocate depth pixel array and add event to process depth data
				depthPixels = new DepthImagePixel[sensor.DepthStream.FramePixelDataLength];
				sensor.DepthFrameReady += DepthFrameReady;

				// Near mode
				//sensor.SkeletonStream.EnableTrackingInNearRange = true;
				//sensor.DepthStream.Range = DepthRange.Near;

				// Enable interaction tracking
				interactionStream = new InteractionStream(sensor, new InteractionClient());
				// Add event to process interactions
				interactionStream.InteractionFrameReady += InteractionFrameReady;

				// Create speech recognition engine
				RecognizerInfo ri = GetKinectRecognizer();
				if (ri != null)
				{
					speechEngine = new SpeechRecognitionEngine(ri.Id);
					if (speechEngine != null)
					{
						// Create grammar from XML file
                        Grammar grammar = new Grammar(@"..\..\SpeechGrammar.xml");
						grammar.Enabled = true;
						speechEngine.LoadGrammar(grammar);

						// Enable speech recognition
						speechEngine.SpeechRecognized += SpeechRecognized;
						//speechEngine.SpeechRecognitionRejected += SpeechRejected;
					}
				}

				try
				{
					// Start sensor
					sensor.Start();

					// Change elevation angle
					sensor.ElevationAngle = 0;

					FleckLog.Info("Kinect sensor started");

					// Start speech recognition
					if (speechEngine != null)
					{
						speechEngine.SetInputToAudioStream(sensor.AudioSource.Start(), new SpeechAudioFormatInfo(EncodingFormat.Pcm, 16000, 16, 1, 32000, 2, null));
						speechEngine.RecognizeAsync(RecognizeMode.Multiple);
						FleckLog.Info("Speech recognition started");
					}
					else
					{
						FleckLog.Error("No speech recognition available");
					}
				}
				catch (System.IO.IOException exception)
				{
					FleckLog.Error("Kinect sensor failed to start", exception);
				}
				catch (System.InvalidOperationException exception)
				{
					FleckLog.Error("Speech recognition failed to start", exception);
				}
			}
			else
			{
				FleckLog.Error("No Kinect sensors available");
			}
		}

		private static void SkeletonFrameReady(object sender, SkeletonFrameReadyEventArgs e)
		{
			// Open skeleton frame
			using (SkeletonFrame skeletonFrame = e.OpenSkeletonFrame())
			{
				// Check if frame is available
				if (skeletonFrame != null)
				{
					// Copy skeletal data to provided array
					skeletonFrame.CopySkeletonDataTo(skeletons);

					// Provide skeletal data for interaction frame computation
					interactionStream.ProcessSkeleton(skeletons, sensor.AccelerometerGetCurrentReading(), skeletonFrame.Timestamp);

					// Get first (default) tracked skeleton
					Skeleton skeleton = (from s in skeletons where s.TrackingState == SkeletonTrackingState.Tracked select s).FirstOrDefault();
					if (skeleton != null)
					{
						// Is new skeleton tracked?
						if (skeleton.TrackingId != tracked)
						{
							tracked = skeleton.TrackingId;	// save ID for interaction tracking
							history.Clear();				// initialise new history
						}
						
						// Send the positions of the hands to the client
						SendPosition("left", skeleton.Joints[JointType.HandLeft]);
						SendPosition("right", skeleton.Joints[JointType.HandRight]);

						// Gesture recognition
						GestureRecognition(skeletonFrame.Timestamp, new Joint[] { skeleton.Joints[JointType.HandLeft], skeleton.Joints[JointType.HandRight] });
					}
				}
			}
		}

		private static void SendPosition(string hand, Joint handJoint) {
			// Check if hand is tracked
			if (handJoint.TrackingState == JointTrackingState.Tracked) {
				// Translate position
				double x = TranslatePosition(handJoint.Position.X);
				double y = TranslatePosition(-handJoint.Position.Y);

				// Check if pointer is within tracking area
				if (0.0 <= x && x <= 1.0 && 0.0 <= y && y <= 1.0)
				{
					// Assemble JSON
					StringWriter sw = new StringWriter();
					JsonTextWriter jw = new JsonTextWriter(sw);
					jw.WriteStartObject();				// {
					jw.WritePropertyName("type");		// "type" : position
					jw.WriteValue("pointer");
					jw.WritePropertyName("hand");		// "hand" : left or right 
					jw.WriteValue(hand);
					jw.WritePropertyName("x");			// "x" : translated x coordinate
					jw.WriteValue(x);
					jw.WritePropertyName("y");			// "y" : translated y coordinate
					jw.WriteValue(y);
					jw.WriteEndObject();				// }
					SendMessage(sw.ToString());
				}
			}
		}

		// Calculate new position in ratio to the tracking area
		// 0.0 is the left or top edge of this area
		// 1.0 is the right or bottom edge of this area 
		private static double TranslatePosition(float pointerDeviation)
		{
			return (pointerDeviation + maxDeviation) / (2 * maxDeviation);
		}

		private static void DepthFrameReady(object sender, DepthImageFrameReadyEventArgs e)
		{
			// Open depth frame
			using (DepthImageFrame depthFrame = e.OpenDepthImageFrame())
			{
				// Check if frame is available
				if (depthFrame != null)
				{
					// Copy depth information to provided array
					depthFrame.CopyDepthImagePixelDataTo(depthPixels);

					// Provide depth data for interaction frame computation
					interactionStream.ProcessDepth(depthPixels, depthFrame.Timestamp);
				}
			}
		}

		private static void InteractionFrameReady(object sender, InteractionFrameReadyEventArgs e)
		{
			// Open interaction frame
			using (InteractionFrame interactionFrame = e.OpenInteractionFrame())
			{
				// Check if frame is available
				if (interactionFrame != null)
				{
					// Get user information from interaction frame
					UserInfo[] users = new UserInfo[InteractionFrame.UserInfoArrayLength];
					interactionFrame.CopyInteractionDataTo(users);

					// Process interaction information of tracked user
					UserInfo user = (from u in users where u.SkeletonTrackingId == tracked select u).FirstOrDefault();
					if (user != null && user.HandPointers != null)
					{
						string handType;
						foreach (InteractionHandPointer pointer in user.HandPointers)
						{
							// Check whether pointer is tracked
							if (pointer.IsTracked)
							{
								// Check hand type
								if (pointer.HandType == InteractionHandType.Left)
									handType = "left";
								else if (pointer.HandType == InteractionHandType.Right)
									handType = "right";
								else
									continue;

								// Grip
								if (pointer.HandEventType == InteractionHandEventType.Grip)
									SendGesture("grip", handType);
								else if (pointer.HandEventType == InteractionHandEventType.GripRelease)
									SendGesture("release", handType);

								// Press
								if (pointer.IsPressed)
									SendGesture("press", handType);
							}
						}
					}
				}
			}
		}

		private static void GestureRecognition(long timestamp, Joint[] hands)
		{
			// Remember both hand joints for later gesture recognition
			history.Add(timestamp, hands);

			if (history.Length() > maxHistoryLength)	// Is history big enought?	
			{
				history.RemoveOldest();	// keep history at specified length

				if (timestamp - lastRecognition >= timeframe) // Is gesture recognition timeout elapsed?
				{
					// Reference
					long timestampRef = history.GetOldestKey();
					Joint[] handsRef;

					// Is gesture within timeframe and a reference value available
					if (timestamp - timestampRef <= timeframe &&
						history.TryGetValue(timestampRef, out handsRef))
					{
						// Pinch open and close gestures
						if (hands[0].TrackingState == JointTrackingState.Tracked &&
							hands[1].TrackingState == JointTrackingState.Tracked &&		// Are current and
							handsRef[0].TrackingState == JointTrackingState.Tracked &&	// referent joints tracked?
							handsRef[1].TrackingState == JointTrackingState.Tracked)
						{
							// Current vector from right to left hand
							float distX = hands[0].Position.X - hands[1].Position.X;
							float distY = hands[0].Position.Y - hands[1].Position.Y;

							// Reference vector from right to left hand
							float distXRef = handsRef[0].Position.X - handsRef[1].Position.X;
							float distYRef = handsRef[0].Position.Y - handsRef[1].Position.Y;

							// Magnitude of each vector
							double magnitude = Math.Sqrt(distX * distX + distY * distY);
							double magnitudeRef = Math.Sqrt(distXRef * distXRef + distYRef * distYRef);

							if (magnitudeRef <= 0.1f && magnitude >= 0.7f)
							{
								lastRecognition = timestamp;
								SendGesture("pinchOpen");
								return;
							}

							if (magnitudeRef >= 0.7f && magnitude <= 0.1f)
							{
								lastRecognition = timestamp;
								SendGesture("pinchClose");
								return;
							}
						}


						// Flick gesture along x axis (horizontal)
						// first left hand (0) the right hand (1)
						for (int i = 0; i < 2; i++)
						{
							if (hands[i].TrackingState == JointTrackingState.Tracked &&		// Is current and
								handsRef[i].TrackingState == JointTrackingState.Tracked)	// was referent joint tracked?
							{
								// Change: current value minus reference value
								float deltaX = hands[i].Position.X - handsRef[i].Position.X;
								float deltaY = hands[i].Position.Y - handsRef[i].Position.Y;

								// Absolute value of change
								float absX = Math.Abs(deltaX);
								float absY = Math.Abs(deltaY);

								if (absX >= 0.40f && absY <= 0.075f)	// Test for flick conditions
								{
									lastRecognition = timestamp;

									// Check direction
									if (deltaX < 0.0f)
										SendGesture(handType[i], "flickLeft");		// flick to the left
									else
										SendGesture(handType[i], "flickRight");		// flick to the right

									return;
								}
							}
						}
					}
				}
			}
		}

		private static void SendGesture(string gesture)
		{
			// Assemble JSON
			StringWriter sw = new StringWriter();
			JsonTextWriter jw = new JsonTextWriter(sw);
			jw.WriteStartObject();				// {
			jw.WritePropertyName("type");		// "type" : gesture
			jw.WriteValue(gesture);
			jw.WriteEndObject();				// }
			SendMessage(sw.ToString());
		}

		private static void SendGesture(string gesture, string hand)
		{
			// Assemble JSON
			StringWriter sw = new StringWriter();
			JsonTextWriter jw = new JsonTextWriter(sw);
			jw.WriteStartObject();				// {
			jw.WritePropertyName("type");		// "type" : gesture
			jw.WriteValue(gesture);
			jw.WritePropertyName("hand");		// "hand" : left or right
			jw.WriteValue(hand);
			jw.WriteEndObject();				// }
			SendMessage(sw.ToString());
		}

		private static RecognizerInfo GetKinectRecognizer()
		{
			foreach (RecognizerInfo recognizer in SpeechRecognitionEngine.InstalledRecognizers())
			{
				string value;
				recognizer.AdditionalInfo.TryGetValue("Kinect", out value);
				if ("True".Equals(value, StringComparison.OrdinalIgnoreCase) && "en-US".Equals(recognizer.Culture.Name, StringComparison.OrdinalIgnoreCase))
				{
					return recognizer;
				}
			}

			return null;
		}

		private static void SpeechRecognized(object sender, SpeechRecognizedEventArgs e)
		{
			RecognitionResult result = e.Result;
			if (result != null && result.Confidence >= confidenceThreshold && result.Semantics.ContainsKey("type"))
			{
				// Assemble JSON
				StringWriter sw = new StringWriter();
				JsonTextWriter jw = new JsonTextWriter(sw);
				jw.WriteStartObject();													// {
				jw.WritePropertyName("type");											// "type" : recognised speech command
				jw.WriteValue(Convert.ToString(result.Semantics["type"].Value));
				if (result.Semantics.ContainsKey("num"))
				{
					jw.WritePropertyName("num");										// "num" : additional number
					jw.WriteValue(Convert.ToInt32(result.Semantics["num"].Value));
				}
				jw.WriteEndObject();													// }
				SendMessage(sw.ToString());
			}
		}

		private static void SendMessage(string message)
		{
			if (activeSocket != null && activeSocket.IsAvailable == true)
				activeSocket.Send(message);
			FleckLog.Debug("Message sent: " + message);
		}
	}
}
