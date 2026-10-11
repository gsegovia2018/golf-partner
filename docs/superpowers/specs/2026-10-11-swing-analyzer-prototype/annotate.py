import sys, json, cv2, numpy as np
video, posef, out = sys.argv[1:4]
P = json.load(open(posef)); W, H = P["w"], P["h"]
BALL = (273, 505)
# frame, label, hands, clubhead (None = hidden / foreshortened), clubhead estimated?
CP = [
 (300, "1 Address",            (210, 425), (270, 505), False),
 (398, "2 Takeaway",           (207, 412), (220, 475), False),
 (434, "3 Lead arm parallel",  (190, 365), (115, 270), False),
 (458, "4 Late backswing",     (185, 317), (150, 197), False),
 (495, "5 Top",                (185, 306), (215, 303), False),
 (536, "6 Transition",         (210, 375), None,       False),
 (550, "7 Pre-impact",         (222, 400), (240, 470), False),
 (556, "8 Impact",             (220, 405), (275, 505), False),
 (566, "9 Post-impact",        (209, 407), (248, 454), False),
 (600, "10 Follow-through",    (168, 302), (123, 189), False),
 (640, "11 Finish",            (157, 274), (205, 296), True),
]
EDGES = [(11,12),(11,13),(13,15),(12,14),(14,16),(11,23),(12,24),(23,24),(23,25),(25,27),(24,26),(26,28)]
cap = cv2.VideoCapture(video); tiles = []; k = 2; x0, y0, x1, y1 = 60, 150, 340, 540
for n, label, hands, club, est in CP:
    cap.set(cv2.CAP_PROP_POS_FRAMES, n); ok, f = cap.read()
    t = cv2.resize(f[y0:y1, x0:x1], None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
    m = lambda p: (int((p[0] - x0) * k), int((p[1] - y0) * k))
    lm = np.array(P["frames"][n])[:, :2] * [W, H]
    for a, b in EDGES: cv2.line(t, m(lm[a]), m(lm[b]), (255, 255, 255), 1, cv2.LINE_AA)
    cv2.circle(t, m(BALL), 9, (255, 255, 255), 2)
    if club:
        cv2.line(t, m(hands), m(club), (0, 220, 255), 2, cv2.LINE_AA)
        cv2.circle(t, m(club), 8, (0, 0, 255), -1 if not est else 2)
    hx, hy = m(hands); cv2.rectangle(t, (hx-7, hy-7), (hx+7, hy+7), (255, 120, 0), -1)
    cv2.rectangle(t, (0, 0), (t.shape[1], 34), (0, 0, 0), -1)
    cv2.putText(t, f"{label}  #{n}", (8, 24), 0, 0.7, (255, 255, 255), 2, cv2.LINE_AA)
    tiles.append(t)
cols = 4
while len(tiles) % cols: tiles.append(np.full_like(tiles[0], 30))
sheet = np.vstack([np.hstack(tiles[i:i+cols]) for i in range(0, len(tiles), cols)])
legend = sheet[-tiles[0].shape[0]:, -tiles[0].shape[1]:]
for i, (txt, col) in enumerate([("Hands (square)", (255,120,0)), ("Clubhead (dot; ring = estimated)", (0,0,255)),
                                ("Shaft line", (0,220,255)), ("Ball (ring)", (255,255,255)), ("Pose skeleton (model)", (200,200,200))]):
    cv2.putText(legend, txt, (20, 60 + i * 40), 0, 0.6, col, 2, cv2.LINE_AA)
cv2.imwrite(out, sheet)
# body measurements from the pose model
def body(n):
    lm = np.array(P["frames"][n])[:, :2] * [W, H]
    hip, sh = (lm[23] + lm[24]) / 2, (lm[11] + lm[12]) / 2
    spine = np.degrees(np.arctan2(sh[0] - hip[0], hip[1] - sh[1]))
    return dict(nose=lm[0].round(), hip=hip.round(), rear_hip_x=round(min(lm[23][0], lm[24][0])), spine_tilt=round(spine, 1))
for n in (300, 495, 556): print(n, body(n))
