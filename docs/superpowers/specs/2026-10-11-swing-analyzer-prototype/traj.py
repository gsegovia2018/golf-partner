import json, sys, numpy as np
d = json.load(open(sys.argv[1])); W, H = d["w"], d["h"]
F = np.array([np.array(f)[:, :2] * [W, H] for f in d["frames"]])
hands = (F[:, 15] + F[:, 16]) / 2
sp = np.r_[0, np.linalg.norm(np.diff(hands, axis=0), axis=1)]
for i in range(0, len(F), 6):
    print(f"{i:4d} {i/d['fps']:5.1f}s hands=({hands[i,0]:5.0f},{hands[i,1]:5.0f}) speed={sp[max(0,i-3):i+3].mean():5.1f}")
