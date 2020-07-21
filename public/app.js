function logIt(message, error) {
  // Print on console
  console.log(message);

  // Add to logs on page
  let logs = document.getElementById("logs");
  let tmp = document.createElement("P");
  tmp.innerText = message;
  if (error) {
    tmp.classList.add("error");
  }
  logs.appendChild(tmp);
}

var VideoChat = {
  backgrounds: [
    "greatwall",
    "pyramid",
    "Colosseum",
    "monchu",
    "ayers-rock",
    "taj",
    "easter-island",
    "moon",
  ],
  connected: false,
  socket: io(),
  localICECandidates: [],

  localVideo: document.getElementById("localVideo"),
  localCanvas: document.getElementById("localCanvas"),
  bghandler: document.getElementById("change-bg"),
  videoBtn: document.getElementById("get-video"),
  callBtn: document.getElementById("call"),
  remoteVideo: document.getElementById("remoteVideo"),

  requestMediaStream: function () {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => VideoChat.onMediaStream(stream))
      .catch((error) => VideoChat.onMediaError(error));
  },
  onMediaStream: function (stream) {
    VideoChat.localVideo.volume = 0;
    VideoChat.localStream = stream;
    VideoChat.videoBtn.setAttribute("disabled", "disabled");
    // Add the stream as video's srcObject.
    // As the video has the `autoplay` attribute it will start to stream immediately.
    VideoChat.localVideo.srcObject = stream;
    VideoChat.localVideo.play();

    VideoChat.bghandler.hidden = false;

    // Now we're ready to join the chat room.
    VideoChat.socket.emit("join", "test");
    VideoChat.socket.on("ready", VideoChat.readyToCall);
    VideoChat.socket.on("offer", VideoChat.onOffer);
    bodyPix
      .load()
      .then((net) => (VideoChat.net = net))
      .catch((error) => logIt("loading...", error));
  },
  onMediaError: function (error) {
    console.log(error);
  },
  onChangeBg: function () {
    VideoChat.localVideo.hidden = true;
    VideoChat.localCanvas.hidden = false;
    VideoChat.localCanvas.width = VideoChat.localVideo.width;
    VideoChat.localCanvas.height = VideoChat.localVideo.height;
    bgIndex = Math.floor(Math.random() * VideoChat.backgrounds.length);
    VideoChat.localCanvas.style.background = `url("images/${VideoChat.backgrounds[bgIndex]}.jpg") no-repeat`;
    VideoChat.localCanvas.style.backgroundSize = "cover";
    VideoChat.perform(VideoChat.net);
    tempStream = VideoChat.localCanvas.captureStream();
    if (VideoChat.peerConnection) {
      console.log(VideoChat.peerConnection);
      VideoChat.peerConnection.localStream.replaceTrack(
        tempStream.getVideoTracks()[0]
      );
    }
    VideoChat.localStream = tempStream;
  },
  perform: async function (net) {
    while (true) {
      var segmentation = await net.segmentPerson(VideoChat.localVideo);
      const backgroundBlurAmount = 6;
      const edgeBlurAmount = 2;
      const flipHorizontal = true;

      //   bodyPix.drawBokehEffect(
      //     VideoChat.localCanvas,
      //     VideoChat.localVideo,
      //     segmentation,
      //     backgroundBlurAmount,
      //     edgeBlurAmount,
      //     flipHorizontal
      //   );

      VideoChat.drawImage(segmentation);
    }
  },
  drawImage: function (segmentation) {
    VideoChat.localContext = VideoChat.localCanvas.getContext("2d");
    VideoChat.localContext.drawImage(
      VideoChat.localVideo,
      0,
      0,
      VideoChat.localVideo.width,
      VideoChat.localVideo.height
    );
    var imageData = VideoChat.localContext.getImageData(
      0,
      0,
      VideoChat.localVideo.width,
      VideoChat.localVideo.height
    );
    var pixel = imageData.data;
    for (var p = 0; p < pixel.length; p += 4) {
      if (segmentation.data[p / 4] == 0) {
        pixel[p + 3] = 0;
      }
    }

    VideoChat.localContext.putImageData(imageData, 0, 0);
  },
  startCall: function () {
    logIt(">>> Sending token request...");
    VideoChat.socket.on("token", VideoChat.onToken(VideoChat.createOffer));
    VideoChat.socket.emit("token");
  },
  readyToCall: function () {
    VideoChat.callBtn.removeAttribute("disabled");
  },

  onToken: function (callback) {
    return function (token) {
      logIt("<<< Received token");
      // Set up a new RTCPeerConnection using the token's iceServers.
      VideoChat.peerConnection = new RTCPeerConnection({
        iceServers: token.iceServers,
      });
      console.log(VideoChat.localStream);
      // Add the local video stream to the peerConnection.
      VideoChat.peerConnection.addStream(VideoChat.localStream);
      // Set up callbacks for the connection generating iceCandidates or
      // receiving the remote media stream.
      VideoChat.peerConnection.onicecandidate = VideoChat.onIceCandidate;
      VideoChat.peerConnection.onaddstream = VideoChat.onAddStream;
      // Set up listeners on the socket for candidates or answers being passed
      // over the socket connection.
      VideoChat.socket.on("candidate", VideoChat.onCandidate);
      VideoChat.socket.on("answer", VideoChat.onAnswer);
      callback();
    };
  },

  // When the peerConnection generates an ice candidate, send it over the socket
  // to the peer.
  onIceCandidate: function (event) {
    if (event.candidate) {
      logIt(
        `<<< Received local ICE candidate from STUN/TURN server (${event.candidate.address})`
      );
      if (VideoChat.connected) {
        logIt(`>>> Sending local ICE candidate (${event.candidate.address})`);
        VideoChat.socket.emit("candidate", JSON.stringify(event.candidate));
      } else {
        // If we are not 'connected' to the other peer, we are buffering the local ICE candidates.
        // This most likely is happening on the "caller" side.
        // The peer may not have created the RTCPeerConnection yet, so we are waiting for the 'answer'
        // to arrive. This will signal that the peer is ready to receive signaling.
        VideoChat.localICECandidates.push(event.candidate);
      }
    }
  },

  // When receiving a candidate over the socket, turn it back into a real
  // RTCIceCandidate and add it to the peerConnection.
  onCandidate: function (candidate) {
    rtcCandidate = new RTCIceCandidate(JSON.parse(candidate));
    logIt(
      `<<< Received remote ICE candidate (${rtcCandidate.address} - ${rtcCandidate.relatedAddress})`
    );
    VideoChat.peerConnection.addIceCandidate(rtcCandidate);
  },

  // Create an offer that contains the media capabilities of the browser.
  createOffer: function () {
    logIt(">>> Creating offer...");
    VideoChat.peerConnection.createOffer(
      function (offer) {
        // If the offer is created successfully, set it as the local description
        // and send it over the socket connection to initiate the peerConnection
        // on the other side.
        VideoChat.peerConnection.setLocalDescription(offer);
        VideoChat.socket.emit("offer", JSON.stringify(offer));
      },
      function (err) {
        // Handle a failed offer creation.
        logIt(err, true);
      }
    );
  },

  // Create an answer with the media capabilities that both browsers share.
  // This function is called with the offer from the originating browser, which
  // needs to be parsed into an RTCSessionDescription and added as the remote
  // description to the peerConnection object. Then the answer is created in the
  // same manner as the offer and sent over the socket.
  createAnswer: function (offer) {
    return function () {
      logIt(">>> Creating answer...");
      VideoChat.connected = true;
      rtcOffer = new RTCSessionDescription(JSON.parse(offer));
      VideoChat.peerConnection.setRemoteDescription(rtcOffer);
      VideoChat.peerConnection.createAnswer(
        function (answer) {
          console.log(answer);
          VideoChat.peerConnection.setLocalDescription(answer);
          VideoChat.socket.emit("answer", JSON.stringify(answer));
        },
        function (err) {
          // Handle a failed answer creation.
          logIt(err, true);
        }
      );
    };
  },

  // When a browser receives an offer, set up a callback to be run when the
  // ephemeral token is returned from Twilio.
  onOffer: function (offer) {
    logIt("<<< Received offer");
    VideoChat.socket.on(
      "token",
      VideoChat.onToken(VideoChat.createAnswer(offer))
    );
    VideoChat.socket.emit("token");
  },

  // When an answer is received, add it to the peerConnection as the remote
  // description.
  onAnswer: function (answer) {
    logIt("<<< Received answer");
    var rtcAnswer = new RTCSessionDescription(JSON.parse(answer));
    VideoChat.peerConnection.setRemoteDescription(rtcAnswer);
    VideoChat.connected = true;
    VideoChat.localICECandidates.forEach((candidate) => {
      // The caller now knows that the callee is ready to accept new
      // ICE candidates, so sending the buffer over
      logIt(`>>> Sending local ICE candidate (${candidate.address})`);
      VideoChat.socket.emit("candidate", JSON.stringify(candidate));
    });
    // Reset the buffer of local ICE candidates. This is not really needed
    // in this specific client, but it's good practice
    VideoChat.localICECandidates = [];
  },

  // When the peerConnection receives the actual media stream from the other
  // browser, add it to the other video element on the page.
  onAddStream: function (event) {
    logIt("<<< Received new stream from remote. Adding it...");
    VideoChat.remoteVideo.srcObject = event.stream;
    VideoChat.remoteVideo.volume = 0.7;
  },
};

VideoChat.bghandler.addEventListener("click", VideoChat.onChangeBg, false);

VideoChat.videoBtn.addEventListener(
  "click",
  VideoChat.requestMediaStream,
  false
);

VideoChat.callBtn.addEventListener("click", VideoChat.startCall, false);
