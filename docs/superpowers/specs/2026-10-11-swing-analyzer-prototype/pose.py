import sys, json, cv2, numpy as np, mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions
video, model, out = sys.argv[1:4]
opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=model),
        running_mode=vision.RunningMode.VIDEO, num_poses=1)
lm = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(video); fps = cap.get(cv2.CAP_PROP_FPS); i = 0; res = []
while True:
    ok, f = cap.read()
    if not ok: break
    r = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(f, cv2.COLOR_BGR2RGB)), int(i*1000/fps))
    res.append([[p.x, p.y, p.visibility] for p in r.pose_landmarks[0]] if r.pose_landmarks else None)
    i += 1
json.dump({"fps": fps, "w": f.shape[1] if False else int(cap.get(3)), "h": int(cap.get(4)), "frames": res}, open(out, "w"))
print(i, "frames,", sum(r is not None for r in res), "with pose")
