# Down-the-line plane checks from the marked checkpoints + pose shoulders.
import sys, json, math, cv2, numpy as np
video, posef, out = sys.argv[1:4]
P = json.load(open(posef)); W, H = P["w"], P["h"]
lm = lambda n: np.array(P["frames"][n])[:, :2] * [W, H]
BALL = np.array([273., 505.])
CP = {"address":(300,(210,425),(270,505)), "takeaway":(398,(207,412),(220,475)), "lead_arm_parallel":(434,(190,365),(115,270)),
      "late_backswing":(458,(185,317),(150,197)), "top":(495,(185,306),(215,303)), "transition":(536,(210,375),None),
      "pre_impact":(550,(222,400),(240,470)), "impact":(556,(220,405),(275,505)), "post_impact":(566,(209,407),(248,454)),
      "follow_through":(600,(168,302),(123,189))}
a = lm(300); trail_sh = a[12] if a[12][0] < a[11][0] else a[11]   # trail (right) shoulder: the one nearer the camera/left
print("shoulders@address L", a[11].round(), "R", a[12].round(), "-> trail", trail_sh.round())
def ang(p, q):  # angle of segment above horizontal, degrees
    d = np.array(q) - np.array(p); return math.degrees(math.atan2(-d[1], abs(d[0])))
hands0 = np.array(CP["address"][1])
shaft_ang, shoulder_ang = ang(BALL, hands0), ang(BALL, trail_sh)
print(f"shaft plane {shaft_ang:.1f}deg, shoulder plane {shoulder_ang:.1f}deg above ground")
def side(pt, through):  # signed px: + = on the ball side (outside/above) of the line BALL->through
    d = np.array(through) - BALL; v = np.array(pt) - BALL
    return float((d[0]*v[1] - d[1]*v[0]) / np.linalg.norm(d)) * (-1)
for k, (n, h, c) in CP.items():
    s = f"{k:18s} #{n} hands vs shaft-plane {side(h, hands0):+6.1f}  vs shoulder-plane {side(h, trail_sh):+6.1f}"
    if c:
        s += f" | shaft {ang(h, c) if c[1] > h[1] else -ang(c, h):+6.1f}deg"
        # butt-end line extended down to ball height (only when clubhead is above hands)
        if c[1] < h[1]:
            d = np.array(h) - np.array(c); t = (BALL[1] - h[1]) / d[1]; s += f"  butt points at x={h[0] + d[0]*t:5.0f} (ball {BALL[0]:.0f}, toes ~200)"
        else:
            s += f"  clubhead vs shaft-plane {side(c, hands0):+6.1f}"
    print(s)
# Drawing: address frame + both plane lines + hand path + clubhead path
cap = cv2.VideoCapture(video); cap.set(cv2.CAP_PROP_POS_FRAMES, 300); _, f = cap.read()
k = 2; img = cv2.resize(f, None, fx=k, fy=k, interpolation=cv2.INTER_CUBIC)
def ext(p, q, y_end):
    d = np.array(q) - np.array(p); t = (y_end - p[1]) / d[1]; return tuple(int(v*k) for v in np.array(p) + d * t)
B = tuple(int(v*k) for v in BALL)
cv2.line(img, B, ext(BALL, hands0, 150), (0, 220, 255), 2, cv2.LINE_AA)
cv2.line(img, B, ext(BALL, trail_sh, 150), (0, 140, 255), 2, cv2.LINE_AA)
pts = [tuple(int(v*k) for v in h) for _, h, _ in CP.values()]
for i, p in enumerate(pts):
    if i: cv2.line(img, pts[i-1], p, (255, 120, 0), 2, cv2.LINE_AA)
    cv2.rectangle(img, (p[0]-5, p[1]-5), (p[0]+5, p[1]+5), (255, 120, 0), -1)
for name, (n, h, c) in CP.items():
    if c:
        q = tuple(int(v*k) for v in c); cv2.circle(img, q, 6, (0, 0, 255), -1)
        cv2.putText(img, name.replace("_", " "), (q[0]+8, q[1]-6), 0, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
for i, (t, col) in enumerate([("Shaft plane (address shaft)", (0,220,255)), ("Shoulder plane (ball -> trail shoulder)", (0,140,255)),
                              ("Hand path", (255,120,0)), ("Clubhead at checkpoints", (0,0,255))]):
    cv2.putText(img, t, (16, 1300 + i*30), 0, 0.65, col, 2, cv2.LINE_AA)
cv2.imwrite(out, img[200:1400, :])
