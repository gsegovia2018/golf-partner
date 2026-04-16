# CLAUDE.md

## Project Overview

Golf scoring app for 4 friends across weekend 3-round tournaments. Core features:
- Track scores per round per player
- Random partner pairing each round
- Handicap-aware scoring (Stableford points based on hole handicap index)
- Multi-platform: web + Android

## Intended Stack

- **Backend:** Go (`net/http` or `chi`), REST API
- **Frontend/Mobile:** React Native (shared web + Android codebase) or React PWA
- **State:** Per-session tournament state; no persistent DB required initially

## Domain Concepts

- **Tournament:** A weekend event with 3 rounds across 3 different courses
- **Round:** One 18-hole game on a specific course with assigned partners
- **Handicap:** Each player has a handicap index; each hole has a stroke index (SI) that determines extra shots
- **Stableford scoring:** Points per hole = 2 + (par - strokes + extra shots); target is maximizing points
- **Partner selection:** Two pairs per round, randomized each day

## Architecture Intent

When building:
- Backend handles tournament/round/score persistence and partner randomization logic
- Frontend renders scorecards, leaderboard, and partner assignments
- Course data model: `Course → Holes[]` where each hole has `par`, `stroke_index`, and optionally `distance`
