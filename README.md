Kinect Browser
=============

Kinect Browser is a prototype developed to support the multimodal interaction elicitation study presented in our [ITS 2014 Paper](http://dl.acm.org/citation.cfm?id=2669497). This Git repository contains data from the Kinect Browser study described in that paper as well as Kinect Browser source code:

* The analysis of results is available in [the KinectBrowserAnalysis.xlsx Excel sheet](KinectBrowserAnalysis.xlsx). 
* The source code is available in the [KinectBrowser folder](KinectBrowser). 

Kinect Browser was originally created in the [Global Information Systems Group](http://www.globis.ethz.ch) at ETH Zurich. It is maintained by [Michael Nebeling](http://www.michael-nebeling.de) and was written by Alexander Huber as part of his bachelor thesis supervised by Michael Nebeling at ETH Zurich. It is available as free open-source software distributed under the GPLv3 license. See the file [LICENSE](LICENSE) for more information.

Kinect Browser requires [Kinect for Windows 1.8 SDK](http://www.microsoft.com/en-us/download/details.aspx?id=40278) with KinectInteraction Toolkit, [jQuery](https://github.com/jquery/jquery), [Fleck](https://github.com/statianzo/Fleck), [Json.NET](https://github.com/JamesNK/Newtonsoft.Json), [Greasemonkey](http://www.greasespot.net) and the Firefox browser. The source code consists of the following components:

* a server component implemented using C# (open and start the [Visual Studio solution](KinectBrowser/KinectBrowser.sln)) that interfaces the Kinect,
* a client component implemented in JavaScript (install the [Greasemonkey user script](KinectBrowser/kinectbrowser.user.js) in the Firefox browser), and
* a [grammar file](KinectBrowser/SpeechGrammar.xml) for Kinect Browser's speech commands.

It also contains a copy of the [1$ Unistroke Recognizer](http://depts.washington.edu/aimgroup/proj/dollar/) developed at the University of Washington (distributed under the New BSD License agreement).