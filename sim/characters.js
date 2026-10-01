// The test biped, its variants and the comic bipeds: body shape (options of buildHumanoid in humanoid.js),
// walking speed, movement style, and how the viewer names and describes each (what it is, its traits, a short
// name for the page's lede, and a group that puts the mode cards in rows). Built by build-biped.mjs, one body
// pack per character, merged by the viewer in this order.
//
// A style holds the stride search inside ranges (bounds: [lo, hi], angles in degrees, step width and hip height
// as in gait.js) and sets constants: lift (swing-foot clearance, times the default), armLag (how far the arm
// swing trails the legs, as a fraction of a stride), and optionally armOut (arms swinging outward as they swing
// forward, deg), elbow (bend, deg), neckCrane (neck bent forward at its base and back at the skull, deg) and
// gaze (head pitched down, deg). The search then finds the cheapest stride in that style;
// without a style (the biped) it finds the cheapest stride of all, which moves as little as it can.
export const CHARACTERS = {
  biped: {
    label: 'Biped', file: 'biped.json', speed: 1.0, group: 'humanoid',
    shape: { mass: 30, height: 1.32 },
    what: 'a 1.32 m humanoid', traits: "human proportions, the quadruped's mass and about its hip height", short: 'a test biped',
  },
  kid: {
    label: 'Kid', file: 'kid.json', speed: 1.0, group: 'humanoid',
    // a thin five-year-old: head large for the body, legs short, slender limbs, less muscle per kg
    shape: { mass: 16, height: 1.10, legs: 0.92, arms: 0.95, head: 1.4, neck: 0.85, width: 0.88, muscle: 0.85 },
    style: { bounds: { armSwing: [24, 36], pelvisYaw: [7, 12], trunkSway: [2, 5], vpp: [-0.3, 1] }, lift: 2, armLag: 0.03,
      note: 'a lively walk: arms swinging 24–36° each way, a twisting pelvis, a slight toddle and high steps' },
    what: 'a short, thin child', traits: 'a large head, short legs, slender limbs and less muscle per kilogram', short: 'a thin kid',
  },
  ogre: {
    label: 'Ogre', file: 'ogre.json', speed: 0.7, group: 'humanoid',
    // stumpy legs, long arms, almost no neck; broad and fat, most of it on the belly, hips and thighs,
    // with strong muscles under it (40% more per kg of lean mass). The thighs rub, so the knees must stay apart,
    // and the arms hang out from the sides.
    shape: { mass: 280, height: 2.2, legs: 0.88, arms: 1.1, trunk: 1.08, head: 0.85, neck: 0.6, width: 1.1, muscle: 1.4,
      fat: { hips: 1.6, belly: 2.0, chest: 1.3, arms: 1.15, legs: 1.3 }, armAbduction: 12, softPairs: [['LH_femur', 0.06, 'RH_femur', 0.06]] },
    // as if under a very heavy load: the trunk rocks over each foot, the feet land far apart, the knees stay bent
    style: { bounds: { trunkSway: [8, 11], width: [0.28, 0.38], height: [0.94, 0.98], lean: [4, 12], armSwing: [10, 20] }, lift: 2.5, armLag: 0.05,
      note: 'a heavy-load waddle: the trunk rocking 8–11° over each foot, feet 28–38 cm apart, knees bent, a forward lean and high, stomping steps' },
    what: 'a large, overweight ogre', traits: 'stumpy legs, long arms, a heavy belly and thighs that rub', short: 'a lumbering ogre',
  },
  giant: {
    label: 'Giant', file: 'giant.json', speed: 1.0, group: 'humanoid',
    // long thin legs and arms, a long neck and a short, narrow trunk
    shape: { mass: 200, height: 2.9, legs: 1.12, arms: 1.15, trunk: 0.95, head: 0.85, neck: 1.15, width: 0.8 },
    // lumbering and hunched: a rounded upper back, bent knees, a rolling pelvis and long, trailing arm swings
    style: { bounds: { hunch: [18, 22], lean: [4, 12], armSwing: [32, 42], pelvisYaw: [7, 14], pelvisRoll: [2, 6], trunkSway: [3, 6], height: [0.92, 0.96] }, lift: 2.2, armLag: 0.06,
      note: 'a hunched, lumbering walk: the upper back rounded 18–22°, knees bent, the pelvis rolling and turning, and the arms swinging 32–42° each way, trailing the legs' },
    what: 'a tall, lanky giant', traits: 'long thin legs and arms, a long neck and a narrow frame', short: 'a lanky giant',
  },

  // ---- comic bipeds: exaggerated proportions and motion
  bobble: {
    label: 'Bobblehead', file: 'bobble.json', speed: 1.0, group: 'comic',
    // a huge head (two-fifths of the body mass) on a tiny trunk and stick limbs; the thin legs have strong muscles
    shape: { mass: 20, height: 1.05, head: 1.7, neck: 0.4, trunk: 0.75, legs: 0.8, arms: 0.85, feet: 0.9, width: 0.9,
      girth: { arms: 0.6, legs: 0.7, neck: 1.3 }, muscle: { legs: 2.2, arms: 1.5 } },
    style: { bounds: { armSwing: [18, 28], trunkSway: [4, 7], pelvisYaw: [6, 10], lean: [-10, 10], vpp: [0, 2.5] }, lift: 2.5, armLag: 0.04, armOut: 15,
      note: 'a bobbing toddle: the trunk rocking 4–7°, the arms flapping outward as they swing 18–28° each way, and high steps' },
    what: 'a bobblehead', traits: 'a huge, heavy head on a tiny trunk and stick-thin limbs', short: 'a bobblehead',
  },
  hood: {
    label: 'Hood', file: 'hood.json', speed: 0.6, group: 'comic',
    // a deeply rounded back on a flexible spine, the neck leaving the ribcage low and forward, shoulders hunched up
    // and forward, short legs
    shape: { mass: 40, height: 1.3, legs: 0.8, arms: 0.85, trunk: 1.1, neck: 1.2, head: 1.15, width: 1.05, girth: { chest: 1.15, arms: 0.8 },
      shoulders: { forward: 0.03, height: 0.035 }, neckBase: { forward: 0.04, height: -0.02 }, spineRange: 1.8, neckRange: 1.6, muscle: { legs: 1.3 } },
    style: { bounds: { hunch: [28, 32], lean: [10, 14], armSwing: [3, 8], height: [0.88, 0.93], pelvisYaw: [2, 6] }, lift: 1.3, elbow: 50, neckCrane: 10, gaze: 15, armLag: 0.02,
      note: 'a hunched shuffle: the back rounded 28–32° over a 10–14° lean, the head low, craned forward and looking down, knees deeply bent, elbows bent and the arms barely swinging (3–8°), and low steps' },
    what: 'a hooded hunchback', traits: 'a deeply rounded back, a neck craned forward, shoulders hunched up and forward and short bent legs', short: 'a hooded hunchback',
  },
  stilts: {
    label: 'Stilts', file: 'stilts.json', speed: 1.0, group: 'comic',
    // very long legs and neck, a tiny head, droopy narrow shoulders, big feet, a thin frame
    shape: { mass: 65, height: 2.5, legs: 1.4, arms: 1.25, trunk: 0.75, neck: 2.0, head: 0.75, feet: 1.25, width: 0.72, girth: { legs: 0.85 },
      shoulders: { width: 0.85, height: -0.025 }, neckRange: 1.2, muscle: { arms: 2.5, legs: 1.7 } },
    style: { bounds: { armSwing: [32, 42], pelvisYaw: [8, 14], lean: [-8, -3], trunkCounter: [0.6, 1.5], vpp: [-0.3, 1] }, lift: 2.2, armLag: 0.1, armOut: 6,
      note: 'a high-stepping stroll: leaning back 3–8°, the knees lifted high, the pelvis twisting 8–14°, and huge windmilling arm swings (32–42° each way) that trail the legs' },
    what: 'a stilt-legged beanpole', traits: 'very long legs, a long neck, a tiny head, droopy shoulders and big feet', short: 'a beanpole',
  },
  pear: {
    label: 'Pear', file: 'pear.json', speed: 0.8, group: 'comic',
    // narrow sloping shoulders over huge hips and thighs, stubby legs, short arms resting out over the hips
    shape: { mass: 110, height: 1.7, legs: 0.72, arms: 0.8, trunk: 1.15, neck: 0.5, head: 0.8, girth: { hips: 1.55, waist: 1.3, chest: 0.85, legs: 1.25, arms: 0.8 },
      shoulders: { width: 0.7, height: -0.035 }, fat: { hips: 1.9, belly: 1.4, legs: 1.5 }, muscle: { legs: 1.7 }, armAbduction: 22, softPairs: [['LH_femur', 0.07, 'RH_femur', 0.07]] },
    style: { bounds: { trunkSway: [3, 6], width: [0.22, 0.32], pelvisRoll: [2, 6], pelvisYaw: [2, 8], armSwing: [4, 10], vpp: [-0.3, 1] }, lift: 1.8, armOut: 8, armLag: 0.03,
      note: 'a side-to-side waddle: the trunk rocking 3–6°, feet 22–32 cm apart, the pelvis rolling 2–6°, and the short arms held out over the hips, barely swinging (4–10°)' },
    what: 'a pear-shaped body', traits: 'narrow sloping shoulders over huge hips and thighs, stubby legs, short arms and a small head', short: 'a pear-shaped waddler',
  },
  brute: {
    label: 'Brute', file: 'brute.json', speed: 1.0, group: 'comic',
    // enormous shoulders and arm muscles, a barrel chest, the head sunk between hunched-up shoulders, short legs
    shape: { mass: 150, height: 1.85, legs: 0.8, arms: 1.3, trunk: 1.1, neck: 0.3, head: 0.8, width: 1.1, girth: { chest: 1.35, waist: 1.1, arms: 1.45, neck: 1.6 },
      shoulders: { width: 1.35, height: 0.045, forward: 0.02 }, neckBase: { height: -0.03, forward: 0.025 }, muscle: { spine: 1.4, neck: 1.5, legs: 1.6 }, armAbduction: 14 },
    style: { bounds: { armSwing: [14, 22], trunkCounter: [0.4, 1.0], pelvisYaw: [6, 12], lean: [8, 14], trunkSway: [3, 6], vpp: [-0.3, 1] }, lift: 1.8, armLag: 0.08, armOut: 10, elbow: 30,
      note: 'a swagger: leaning 8–14° forward, the shoulders rolling against the hips, and the heavy arms swinging wide (14–22° each way), elbows bent, trailing the legs' },
    what: 'a top-heavy brute', traits: 'enormous shoulders and arms, a barrel chest, a small head sunk between hunched-up shoulders and short legs', short: 'a top-heavy brute',
  },
};
