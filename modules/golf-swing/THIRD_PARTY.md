# Third-party notices: golf-swing

Components this module uses or ships, with their licences. The in-app credit
is the line under the swing home screen's footer (`swing.home.attribution` and
`swing.home.attributionClub`).

| Component | Licence | Use | Notes |
|---|---|---|---|
| MediaPipe Tasks (`com.google.mediapipe:tasks-vision`) | Apache 2.0 | Pose detection in pass 1 and pass 2 | Credited in-app. |
| YOLOX (Megvii) | Apache 2.0 | Club-head detector architecture and COCO starting weights | Only the Apache-2.0 code and weights are used. |
| Golf Club Tracking dataset (`club-head-tracking/golf-club-tracking`, v2), Roboflow Universe: https://universe.roboflow.com/club-head-tracking/golf-club-tracking | CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/) | Training data for the club detector | Modified: the shipped `club_yolox_tiny_v1.tflite` is fine-tuned detector weights derived from this data. Attribution: club-head-tracking, Roboflow Universe. |
| LiteRT (`com.google.ai.edge.litert:litert`, `litert-gpu`, `litert-gpu-api` 1.4.2) | Apache 2.0 | Runs the TFLite club detector on device (GPU, CPU fallback) | Java package `org.tensorflow.lite`. |

No AGPL-3.0 code or weights ship in this module. The Ultralytics YOLO11m checkpoint is
lab-only and nothing derived from it ships.
