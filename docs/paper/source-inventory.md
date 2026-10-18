# Paper source inventory
File01M56HDQ3W1XEMMPDXTW7HM2VB pagep-2-0, read2026-10-18. Design thresholds are proposals, preserve current scorer calibration. Renderers visual only, no audio playback claim.

## IR-0
G2 PIANO COACH · MISTAKE CUES
Every way a note can go wrong — and how the glasses show it.
Mistakes are compared note by note: pitch, presence, timing, and length, plus phrase-level patterns. Each card is one animation: a static state, replay keyframes at actual 576 × 288 glasses resolution, and a motion spec. Every screen shows only one mistake.
Core
SHIP FIRST
01{'  '}Wrong note
02{'  '}Missing note
03{'  '}Extra note
04{'  '}Early or late note
05{'  '}Note too short or too long
06{'  '}Unclear audio — neutral retry
Later
PHRASE-LEVEL
L1{'  '}Rushing or slowing down
L2{'  '}Uneven rhythm
L3{'  '}Unexpected pause
L4{'  '}Playing during a rest
L5{'  '}Repeated or skipped section
L6{'  '}Recurring trouble spot
Every card
MUST
✓{'  '}Label EXPECTED and DETECTED in words
✓{'  '}End with a short correction cue
✓{'  '}Have a static state + replay keyframes
✓{'  '}Work without color: shape, fill, labels
✓{'  '}Show one mistake per glasses screen
ALSO CONSIDERED
Wrong octave and missed ♯/♭ → handled inside 01 by octave labels (F4 vs F5) and black/white key callouts. Swapped order → shown as a paired 02 + 03. Dynamics, chords, hands out of sync → backlog. Fingering, posture, and pedal can't be heard, so they're taught upfront in the Guide view rather than flagged.
SHARED VISUAL LANGUAGE
Every animation uses these symbols, so the student only has to learn them once.
Solid = expected · Hollow = detected
Shape carries meaning, never color alone. The solid note is the target; the hollow note is what the mic detected. Both are labelled in words on screen.
Focus band
A filled column marks the beat being discussed. Everything outside it dims to 50%.
EXPECTED
DETECTED
Beat ruler
A timeline under the staff. The tall solid tick is where the beat falls; the hollow circle is when the note was detected.
EXPECTED
DETECTED
2 beats vs 1 beat
Duration bar
An outlined bar shows the expected length; a solid filled bar shows the detected length. Note symbols (♩ / 𝅗𝅥) sit beside each.
E
F
Key states
Lit key = play this one. Dashed key = the key that was pressed by mistake.
ghost → target · 400ms
Motion = correction
Motion only ever shows a fix: ghost → target, ease-out. Every animation settles into a static end frame, and tapping ↻ replays it.

## MF-0
PERMUTATIONS & COMBINATIONS
One note, two mistakes:
which one gets shown?
Each detected note is graded on two axes: what was played and when. Read a cell as "what we detected × when it landed" to see which card plays. When a note has two problems, the glasses show only the primary one. The secondary is queued as the next cue, as the arrow shows.
WHAT ↓ · WHEN →
On time
Early
Late
Too short
Too long
Right note
✓
No cue. Counts toward the clean-take streak.
04 Early
Beat ruler, detected tick lands before the beat.
04 Late
Beat ruler, detected tick lands after the beat.
05 Short
Length bars: the detected bar stops before the outline ends.
05 Long
Length bars: the detected bar runs past the outline into the next note.
Wrong note
01
Expected key vs detected key, labelled with octave (F4 / E4).
01 → 04
Pitch first. Timing is queued and only shown if it's still wrong on the next take.
01 + look-ahead
“Hunting” for the key: the cue adds “find F4 one beat earlier” instead of a separate timing card.
01 → 05
Pitch first, length queued.
01 → 05
Pitch first, length queued.
No note (missed)
02
Empty dashed slot in the phrase, then the note drops in.
02 + knock-on
There's no timing to judge on a missed note. If the following notes then rush to catch up, that's one root cause: show only 02 and add “keep the beat through it” to the cue. Don't fire a separate 04 for each rushed note.
Extra note
03
The extra hollow note appears between two expected notes and is crossed out.
03 (timing = position)
An extra note has no "right" time, so where it sits on the beat ruler is what shows when it happened.
02 + 03 = swap · 01 + 01 = self-fix
Missed F + extra F one slot later → show as “order swapped”. Wrong key then right key within ~300 ms → a soft “nice catch”, or no cue at all.
Can’t tell
06 overrides everything
If pitch confidence is low or there's too much background noise for the take, show no mistake cues at all. Show the neutral retry state, so the student is never told they were wrong when we aren't sure.
WHEN SINGLE-NOTE MISTAKES FORM A PATTERN → LATER CARDS
3+ notes in a row early (or late), drifting further
→ L1 Rushing / slowing
Early and late alternate around the beat
→ L2 Uneven rhythm
1 beat where the phrase should continue
→ L3 Unexpected pause
Sound detected inside a written rest
→ L4 Playing during a rest
A run of notes replays an earlier bar, or jumps ahead
→ L5 Repeated / skipped
Same beat flagged in 2+ of the last 3 takes
→ L6 Recurring trouble spot
PRIORITY · ONE CUE AT A TIME
1{'  '}Unclear audio (06) — blocks all cues
2{'  '}Missing / extra / skipped (02, 03, L5)
3{'  '}Wrong note (01)
4{'  '}Timing (04, L1–L4)
5{'  '}Length (05)
If a take has several mistakes, review them in order of priority, then by position in the piece. Show at most 3 per take (“1 / 3”). The rest wait for the next take.

## WV-0
02
CORE
Missing note
A note in the phrase was never played. Show exactly where it belongs: an empty, outlined slot between its neighbours. Then drop the right note into it, so the phrase reads complete again.
TRIGGER
An expected note has no detected onset within its beat window, while the notes around it were detected.
WITHOUT COLOR
Dashed empty slot = missing, solid note = expected, and the word “silence” in place of a detected note name.
COMBINATIONS
Missed note + the rest of the bar rushes → show only 02 and add “keep the beat through it”. Missed F + extra F one slot later → show as “order swapped”.
STATIC STATE
default · reduced motion · after replay
Beat 6 · missed note
1 / 2
F4
[ F4 ]
D4
●{'  '}Expected{'  '}F4
○{'  '}Detected{'  '}—
Play F4 twice, then D
tap{'  '}↻ replay
▼{'  '}next
The empty dashed slot sits where the note belongs in the phrase. “Detected —” says in words that nothing was heard.
REPLAY 1 · SWEEP
0 – 600 ms
Beat 6 · missed note
1 / 2
𝄞
EXPECTED F4
DETECTED F4 ✓
replaying
●○○
A playhead sweeps the phrase at playback tempo. Each detected note lights up as it's passed, so the student hears the phrase as they played it.
REPLAY 2 · THE GAP
600 – 1100 ms
Beat 6 · missed note
1 / 2
𝄞
● EXPECTED F4
○ DETECTED — silence
replaying
●●○
The playhead stops on beat 6. The focus band appears and the empty dashed slot pulses twice (2 × 200 ms), with no sound, so the silence is felt.
REPLAY 3 · DROP IN
1100 – 1500 ms → static
Beat 6 · missed note
1 / 2
F4
[ F4 ]
D4
replaying
●●●
●{'  '}Expected{'  '}F4
○{'  '}Detected{'  '}—
Play F4 twice▍
The view zooms out to the phrase. A solid F4 drops into the slot (300 ms, ease-out, small settle), the cue types in, and the screen settles into the static state.

## 114-0
03
CORE
Extra note
The student played a note that isn't in the music. Show the extra note between its neighbours and pin it on the beat ruler, so it's clear exactly when it happened. Then strike it out and close the gap.
TRIGGER
A detected onset that doesn't match any expected note, landing between two expected notes that were played correctly.
WITHOUT COLOR
Hollow note with an × = extra, solid notes = expected, a hollow marker on the beat ruler, and a “5½” timing label in words.
COMBINATIONS
Extra note + a missing note one slot later → “order swapped”. Extra note right before the correct one, within ~300 ms → self-correction: soft “nice catch”, or no cue.
STATIC STATE
default · reduced motion · after replay
Beat 5½ · extra note
1 / 2
beat 5
5½
beat 6
●{'  '}Expected{'  '}F{'  '}F
○{'  '}Detected{'  '}F G F
Just F, F: skip the G
tap{'  '}↻ replay
▼{'  '}next
The crossed-out hollow note and the “5½” marker on the ruler show what was added and when. Both note sequences are spelled out.
REPLAY 1 · IN TIME ORDER
0 – 500 ms
Beat 5½ · extra note
1 / 2
𝄞
○ DETECTED G4
beat 5
EXPECTED: nothing
beat 6
replaying
●○○
Notes appear in the order they were played, along the beat ruler. The extra G pops in hollow at beat 5½, between the two expected F's.
REPLAY 2 · STRIKE
500 – 900 ms
Beat 5½ · extra note
1 / 2
𝄞
○ DETECTED G4 × EXTRA
beat 5
EXPECTED: nothing
beat 6
replaying
●●○
An × draws across the extra note (2 strokes, 150 ms each) and it's labelled EXTRA. Its ruler marker stays, so the timing is still visible.
REPLAY 3 · CLOSE THE GAP
900 – 1300 ms → static
Beat 5½ · extra note
1 / 2
beat 5
5½
beat 6
replaying
●●●
●{'  '}Expected{'  '}F{'  '}F
○{'  '}Detected{'  '}F G F
Just F, F▍
The struck note fades to a dotted outline. The two F's slide together (300 ms), the cue types in, and the screen settles into the static state.

## 1I6-0
04
CORE
Early or late note
Right key, wrong moment. Put the expected beat and the detected onset on one beat ruler, so the gap is something the student can see and count, not just feel.
TRIGGER
Right pitch, but the onset is more than ±15% of a beat away from the expected beat (at 80 bpm ≈ ±110 ms). Under 15% is not flagged.
WITHOUT COLOR
Tall solid tick = expected beat, hollow circle = detected onset. Left of the tick = early, right = late, and the gap is labelled in words (“¼ early”).
VARIANTS
½ beat) → hand off to L3 Unexpected pause. Many early in a row → L1 Rushing.
STATIC STATE
default · reduced motion · after replay
Beat 3 · early
1 / 2
2
3
4
¼ early
●{'  '}Expected{'  '}on 3
○{'  '}Detected{'  '}¼ early
Wait for the beat — count 1-2-3
tap{'  '}↻ replay
▼{'  '}next
The ruler shows the gap; the ● / ○ labels name it. Readable with no motion.
REPLAY 1 · DETECTED
0 – 600 ms
Beat 3 · early
1 / 2
𝄞
○ DETECTED
● EXPECTED
replaying
●○○
A playhead sweeps the bar at tempo while the beat ticks pulse. The hollow detected note pops in ahead of beat 3, exactly where it was heard.
REPLAY 2 · ONTO THE BEAT
600 – 1000 ms
Beat 3 · early
1 / 2
𝄞
○ DETECTED
● EXPECTED · ON 3
replaying
●●○
The detected circle slides right onto the tick (400 ms, ease-out) and a solid note lands on beat 3. The tick gives a single metronome ring.
REPLAY 3 · COUNT IT
1000 – 1600 ms → static
Beat 3 · early
1 / 2
1
2
3
4
count…
replaying
●●●
●{'  '}Expected{'  '}on 3
○{'  '}Detected{'  '}¼ early
Wait for the beat▍
Counts 1 · 2 · 3 light up in time and 3 gets a box. The cue types in, and the screen settles into the static state.
VARIANT · LATE
static, mirror image
Beat 3 · late
1 / 2
2
3
4
¼ late
●{'  '}Expected{'  '}on 3
○{'  '}Detected{'  '}¼ late
Play right on 3 — don’t wait
tap{'  '}↻ replay
▼{'  '}next
Same ruler, but the detected circle sits right of the tick. Replay mirrors: the circle slides left onto the beat.

## 2D1-0
05
CORE
Note too short or too long
Right key at the right time, but held for the wrong length. Turn length into a bar the student can watch fill up, and pair it with the note symbol they'll see in their sheet music (half note, quarter note).
TRIGGER
Detected length (onset → release or the next onset) is
130% of the written value. Only checked once pitch and onset have passed.
WITHOUT COLOR
Outlined bar = expected length, solid bar = detected length. The missing or extra part is dashed and labelled in words (“1 beat short”). Note symbols name each value.
VARIANTS
Too long (bar runs past the outline into the next note, cue “lift before the next note”). Staccato habit across many notes → roll up into one phrase-level tip.
STATIC STATE
default · reduced motion · after replay
Beat 7 · too short
1 / 2
EXPECTED
DETECTED
1 beat short
1
2
▭{'  '}Expected{'  '}2 beats
▬{'  '}Detected{'  '}1 beat
Hold D for 2 counts
tap{'  '}↻ replay
▼{'  '}next
Outline vs solid, half-note vs quarter-note symbols, and the gap labelled “1 beat short”. Readable with no motion.
REPLAY 1 · DETECTED
0 – 750 ms (real tempo)
Beat 7 · too short
1 / 2
EXPECTED
2 beats
DETECTED
playing…
1
2
replaying
●○○
The replay runs at the student's tempo. The detected bar fills left to right as the count shows “1”, while the expected outline waits empty above it.
REPLAY 2 · RELEASED EARLY
750 – 1500 ms
Beat 7 · too short
1 / 2
EXPECTED
2 beats
DETECTED
1 beat
1 beat short
1
2
(silent)
replaying
●●○
The detected bar stops at the release and gets a quarter-note cap. Count “2” plays over silence, and the empty part goes dashed: “1 beat short”.
REPLAY 3 · FULL LENGTH
1500 – 3000 ms → static
Beat 7 · too short
1 / 2
EXPECTED · NOW
DETECTED
1
2
replaying
●●●
▭{'  '}Expected{'  '}2 beats
▬{'  '}Detected{'  '}1 beat
Hold D for▍
The expected bar now fills the whole 2 beats in real time, with “1 · 2” counted and a half-note cap at the end. The cue types in, then settles to static.
VARIANT · TOO LONG
static
Beat 5 · too long
1 / 2
♩
EXPECTED
next note
DETECTED
+½
1
2
▭{'  '}Expected{'  '}1 beat
▬{'  '}Detected{'  '}1½ beats
Lift F before the next note
tap{'  '}↻ replay
▼{'  '}next
The solid bar runs past the outline and overlaps the next note's start. The overlap is dashed and labelled “+½”.

## 2ZU-0
06
CORE
Unclear audio
The recording can't support reliable feedback. This is a neutral retry state: no mistake markers and no blame. It explains what the mic heard and gives one fix for the room, so the student never gets told they were wrong when we aren't sure.
TRIGGER
Pitch confidence
WITHOUT COLOR
PIANO and NOISE meters are labelled in words and compared by length. Dashed outline = expected clean notes, solid jagged line = what the mic detected. There are no error symbols, so it can't read as “you did it wrong”.
VARIANTS
Too noisy (move somewhere quieter) · Too quiet (move the phone or glasses closer) · No piano heard (check the mic / start playing). Each gets the same layout and its own one-line fix.
STATIC STATE
default · reduced motion · after replay
Couldn’t hear clearly
take 5
PIANO
NOISE
noise is louder than the piano
Expected{'  '}clear piano
Detected{'  '}mostly noise
Find a quieter spot · tap to try again
tap{'  '}↻ try again
2×{'  '}back
Neutral tone, no mistake markers. Meters compare piano and noise by length and words, and the cue is about the room, not the student.
REPLAY 1 · DETECTED
0 – 800 ms
Couldn’t hear clearly
take 5
EXPECTED · CLEAR NOTES
DETECTED · BACKGROUND NOISE
replaying
●○○
The take's waveform draws left to right. Dashed outlines show where clear notes should stand out; the detected solid line is a dense jagged band with no clear notes.
REPLAY 2 · NOISE FLOOR
800 – 1400 ms
Couldn’t hear clearly
take 5
EXPECTED · CLEAR NOTES
NOISE
DETECTED · NOTES HIDDEN IN NOISE
replaying
●●○
A band fades in behind the jagged line, labelled NOISE. The expected notes sit inside it: the problem is the room, not the playing.
REPLAY 3 · READY TO RETRY
1400 – 2000 ms → static
Couldn’t hear clearly
take 5
PIANO
NOISE
replaying
●●●
Expected{'  '}clear piano
Detected{'  '}mostly noise
Find a quieter spot▍
Cross-fade to the mic and meters. The mic gives one slow pulse (no blinking, no alarm), the cue types in, and the screen settles into the static state.
VARIANT · TOO QUIET
static · same layout for “no piano heard”
Couldn’t hear clearly
take 5
PIANO
needed
NOISE
piano is too faint to read
Expected{'  '}clear piano
Detected{'  '}very quiet
Move the mic closer · tap to try again
tap{'  '}↻ try again
2×{'  '}back
Both meters are nearly empty. Same neutral layout; only the detected label and the one-line fix change.

## 15D-0
L1
LATER
Rushing or slowing down
The notes are right, but the beat drifts across the phrase. Two timelines show the whole phrase: the detected notes slide further from the even expected beat as they go, so the speeding up is visible.
TRIGGER
3+ onsets in a row drift the same way from the grid, and the gaps between them shrink (rushing) or grow (dragging) by more than 8% across the phrase.
WITHOUT COLOR
Tall solid ticks = expected beats, ○ circles = detected onsets, dashed drift lines between them, plus the words “speeding up” / “slowing down”.
VARIANTS
Slowing down → same layout, drift lines lean right, cue “Steady — don’t let it drag”. If the take is steady but faster than the set tempo overall, suggest a new tempo instead.
STATIC STATE
default · reduced motion · after replay
Phrase · speeding up
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
◂ gaps shrink — speeding up
Steady — keep every beat the same
tap{'  '}↻ replay
▼{'  '}next
Both timelines are labelled in words. The leaning drift lines and “gaps shrink” label carry the meaning without motion.
REPLAY 1 · IN TIME
0 – 1200 ms
Phrase · speeding up
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
playhead at set tempo
replaying
●○○
The expected ticks are drawn first. A playhead then sweeps across at the set tempo, and each ○ drops in at the moment it was actually played, so the student can hear and see the drift.
REPLAY 2 · DRIFT
1200 – 1800 ms
Phrase · speeding up
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
◂ each beat lands sooner
replaying
●●○
Dashed drift lines grow from each tick to its ○ (staggered 60 ms). The lines lean more and more, and the label “each beat lands sooner” fades in.
REPLAY 3 · SNAP TO BEAT
1800 – 2300 ms → static
Phrase · speeding up
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
on the beat ✓
replaying
●●●
Steady — keep every▍
Each ○ slides right onto its tick (300 ms, ease-out) and pulses once with a ring. The cue types in, then the screen settles back to static.
VARIANT · STATIC
slowing down
Phrase · slowing down
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
gaps grow — slowing down ▸
Steady — don’t let it drag
tap{'  '}↻ replay
▼{'  '}next
Mirror image: the gaps grow and the drift lines lean right. Same replay sequence, but the ○ circles slide left onto the beat.

## 19M-0
L2
LATER
Uneven rhythm
The average tempo is fine, but the space between notes keeps changing: short, long, short, long. Compare each detected gap with the equal expected gaps so the limp shows up as a pattern.
TRIGGER
Inter-onset gaps vary by more than 20% of a beat around the target, with early and late onsets alternating rather than drifting one way (otherwise it’s L1).
WITHOUT COLOR
Equal “=” marks on the expected row; brackets labelled S (short) and L (long) under the detected row. Size and letter, not shade, carry the meaning.
VARIANTS
Dotted rhythm played straight (or the reverse) → same brackets, cue “Long–short, long–short”. One uneven gap only → use 04 Early/late on that note instead.
STATIC STATE
default · reduced motion · after replay
Phrase · uneven rhythm
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
=
=
=
=
=
=
S
L
S
L
S
S short
L long
Even steps: 1 · 2 · 3 · 4
tap{'  '}↻ replay
▼{'  '}next
Equal = marks against S / L brackets make the unevenness readable in a single still frame.
REPLAY 1 · IN TIME
0 – 1000 ms
Phrase · uneven rhythm
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
playhead at set tempo
replaying
●○○
The playhead sweeps at the set tempo while each ○ drops in at its real moment. You can hear the limp before any labels appear.
REPLAY 2 · COMPARE GAPS
1000 – 2200 ms
Phrase · uneven rhythm
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
=
=
=
S
L
◂ S · too short
replaying
●●○
The gaps highlight one by one (200 ms each) with a band and an S / L bracket, matched against the = gap above. This frame shows gap 3 highlighted.
REPLAY 3 · EVEN OUT
2200 – 2700 ms → static
Phrase · uneven rhythm
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
=
=
=
=
=
=
replaying
●●●
Even steps: 1 · 2▍
The ○ circles ease onto the beat grid (300 ms) and every bracket becomes “=”. The cue types in, then the screen returns to static.

## 1DV-0
L3
LATER
Unexpected pause
The student stopped mid-phrase, usually to find the next note, and then carried on. Highlight the silent gap where the music should have kept moving, and measure it in beats.
TRIGGER
No onset for more than 1 beat beyond the expected next onset, with no written rest there, and the phrase then resumes with the correct next note.
WITHOUT COLOR
The silence is a dashed empty box with the word “silence” inside, measured by a bracket labelled “pause · 1½ beats”. The expected row reads “keep going”.
VARIANTS
Pause plus restart from the bar start → L5 Repeated section. Pause right before a wrong note → show 01 with a look-ahead tip. Pause inside a rest is fine: no cue.
STATIC STATE
default · reduced motion · after replay
Beat 5 · unexpected pause
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
keep going →
silence
pause · 1½ beats
Keep moving — look ahead to F
tap{'  '}↻ replay
▼{'  '}next
The gap is shown as an empty dashed box and is named and measured in words, so it reads without motion or color.
REPLAY 1 · PLAYHEAD
0 – 900 ms
Beat 5 · unexpected pause
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
beats 1–4 on time
replaying
●○○
The playhead runs at the set tempo and drops a ○ on each detected note. Beats 1–4 land cleanly on their ticks.
REPLAY 2 · FREEZE
900 – 1650 ms
Beat 5 · unexpected pause
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
keep going →
silence
1 beat …
replaying
●●○
The playhead keeps going on the expected row while the detected row freezes. A dashed box grows across the gap, and the counter ticks up “½ … 1 … 1½ beats”.
REPLAY 3 · BRIDGE
1650 – 2200 ms → static
Beat 5 · unexpected pause
1 / 1
E
E
G
G
F
F
D
EXPECTED
○ DETECTED
no gap — straight on to F
replaying
●●●
Keep moving — look▍
A dashed bridge arcs over the gap from G to F. The late notes slide left onto their ticks (300 ms) to show the phrase without the pause. The cue types in, then back to static.

## 1MF-0
L4
LATER
Playing during a rest
Sound continued through a written rest, either a held key or an early next note. Show the rest as an empty, outlined slot that should stay silent, and the detected sound sitting inside it.
TRIGGER
Onset or sustained energy above the noise floor for more than 40% of a rest's duration.
WITHOUT COLOR
Rest = outlined empty box with a rest symbol. Detected sound = hollow waveform bars inside it, plus a ×. EXPECTED / DETECTED are spelled out, with ● / ○ markers.
VARIANTS
Held through the rest → cue “lift off on beat 4”. Next note came early → hand off to 04 Early with a rest-specific cue.
STATIC STATE
default · reduced motion · after replay
Beat 4 · sound in a rest
1 / 2
●{'  '}Expected{'  '}silence
○{'  '}Detected{'  '}sound
Lift off on the rest — count it
tap{'  '}↻ replay
▼{'  '}next
The rest box, both labels, and the lift cue are all readable without motion.
REPLAY 1 · PLAYHEAD
0 – 400 ms
Beat 4 · sound in a rest
1 / 2
𝄞
● EXPECTED silence
replaying
●○○
A playhead sweeps beats 1–3 at tempo and stops at the rest. The empty rest box outlines in (150 ms).
REPLAY 2 · DETECTED SOUND
400 – 800 ms
Beat 4 · sound in a rest
1 / 2
𝄞
● EXPECTED silence
○ DETECTED sound · 0.6 beat
replaying
●●○
Hollow waveform bars grow left-to-right inside the rest box, in time with the detected sound. A × marks the box, and the DETECTED label shows how long it lasted.
REPLAY 3 · LIFT
800 – 1200 ms → static
Beat 4 · sound in a rest
1 / 2
LIFT
replaying
●●●
●{'  '}Expected{'  '}silence
○{'  '}Detected{'  '}sound
Lift off on the rest▍
The waveform wipes out right-to-left and an up-arrow (“lift”) rises over the rest. The cue types in, and the screen settles into the static state.

## 1QO-0
L5
LATER
Repeated or skipped section
The student restarted after a slip, or jumped over part of the phrase. Zoom out from notes to a phrase map, so the path they actually took can be traced against the straight expected path.
TRIGGER
Alignment finds a run of 3+ notes matching an earlier segment (repeat/restart) or a gap of 2+ expected notes followed by in-order playing (skip).
WITHOUT COLOR
Expected segments = solid blocks; detected = outlined blocks. Repeats are stacked with “×2”, skips are dashed with “skipped”, the slip point is marked ×, and the loop/jump arrow is labelled in words.
VARIANTS
Skipped section (last frame) → dashed missing block with a jump arc, cue “Don’t skip F F — play it slowly”. Repeated by choice (practice loop) → no cue.
STATIC STATE
default · reduced motion · after replay
Bar 1 · restarted
1 / 2
● EXPECTED
○ DETECTED
E E
G G
F F
D
E E ×2
G G
F F
D
restarted
Slip? Keep going — don’t restart.
tap{'  '}↻ replay
▼{'  '}next
Two rows compare the expected path with the detected path. The restart loop and the ×2 badge are readable without motion.
REPLAY 1 · EXPECTED PATH
0 – 500 ms
Bar 1 · restarted
1 / 2
● EXPECTED
○ DETECTED
E E
G G
F F
D
replaying
●○○
The four expected segments fill in left to right (120 ms each), linked by straight arrows. Empty dashed slots wait below.
REPLAY 2 · DETECTED PATH
500 – 1100 ms
Bar 1 · restarted
1 / 2
● EXPECTED
○ DETECTED
E E
G G
F F
D
E E
G G
restarted
replaying
●●○
The detected path traces bars 1–2. A × drops at the slip, then the loop arrow draws back to the start (300 ms). The later segments are still empty.
REPLAY 3 · LOOP
1100 – 1500 ms → static
Bar 1 · restarted
1 / 2
● EXPECTED
○ DETECTED
E E
G G
F F
D
E E ×2
G G
F F
restarted
replaying
●●●
Slip? Keep going▍
Segment 1 stacks into “×2”, the path finishes segments 3–4, and the loop arrow thickens once. The cue types in, and the screen settles into the static state.
VARIANT · SKIPPED (STATIC)
same replay, jump arc instead of loop
Bar 2 · skipped
1 / 2
● EXPECTED
○ DETECTED
E E
G G
F F
D
E E
G G
skipped
D
jumped ahead
Don’t skip F F — play it slowly.
tap{'  '}↻ replay
▼{'  '}next
Skipped segment = dashed empty block labelled “skipped”, with a labelled jump arc over it. The replay traces the path and the arc draws over the gap.

## 1UX-0
L6
LATER
Recurring trouble spot
The same beats go wrong take after take. Rather than repeating a per-note cue, zoom out across attempts: stack the recent takes, line up the mistakes, and box the spot to practise in isolation.
TRIGGER
The same beat (or adjacent beats) is flagged in 2+ of the last 3 takes, whatever the mistake type.
WITHOUT COLOR
Clean beat = small solid block; flagged beat = hollow block with ×. The trouble spot is boxed with a bracket and labelled “beats 5–6”. Takes are labelled by number.
VARIANTS
Spot fixed on the next take → a brief “beats 5–6 clean ✓”. Two separate spots → show the one with more hits first (1 / 2).
STATIC STATE
default · reduced motion · after replay
Beats 5–6 · trouble spot
take 5
● EXPECTED clean
○ DETECTED 3 of 3 takes
TAKE 3
TAKE 4
TAKE 5
BEATS 5–6
Practice beats 5–6 slowly, 3×
tap{'  '}↻ replay
▼{'  '}next
All three takes, the aligned × marks, the bracket, and the practice cue are readable without motion.
REPLAY 1 · TAKE 3
0 – 400 ms
Beats 5–6 · trouble spot
take 5
● EXPECTED clean
○ DETECTED take 3
TAKE 3
TAKE 4
TAKE 5
replaying
●○○
Take 3's row fills in beat by beat. Its × lands on beat 6. Rows for the later takes wait as dashed outlines.
REPLAY 2 · TAKES 4–5
400 – 900 ms
Beats 5–6 · trouble spot
take 5
● EXPECTED clean
○ DETECTED takes 3–5
TAKE 3
TAKE 4
TAKE 5
replaying
●●○
Takes 4 and 5 drop in (200 ms each). Their × marks land in the same column, and a guide line runs through beat 6 to show the alignment.
REPLAY 3 · BRACKET
900 – 1300 ms → static
Beats 5–6 · trouble spot
take 5
● EXPECTED clean
○ DETECTED 3 of 3 takes
TAKE 3
TAKE 4
TAKE 5
replaying
●●●
Practice beats 5–6▍
A bracket draws clockwise around beats 5–6 across all takes, then the label and practice cue type in. Settles into the static state.

## QW-0 Wrong note
Static576x288 black #000 green #3CFA44. Header top14 left24,20px Montserrat. Expected solid key, detected dashed key. Keyboard left12 top46 300x150; labels right328 width224. Footer top247. Replay detected staff0-300ms, correction ghost-to-target300-700ms, keys700-1100ms then static. Wrong octave2octaves; accidental black key. No fixed F/E values in live rendering.
