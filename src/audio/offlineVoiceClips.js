/**
 * Offline Thai Voice Clip Composer — assembles natural Thai number & mascot speech sequences
 * from pre-bundled `./assets/voice/*.mp3` clips (or embedded `window.__OFFLINE_VOICE_B64__` in single-file mode!).
 */

export const ALL_VOICE_CLIP_KEYS = [
  'd_0', 'd_1', 'd_2', 'd_3', 'd_4', 'd_5', 'd_6', 'd_7', 'd_8', 'd_9',
  'u_et', 'u_sip', 'u_yisip', 'u_roi',
  'w_mailaek', 'w_kha', 'w_bai', 'w_luk',
  'voice_on',
  'pour_a1', 'pour_a2', 'pour_b1', 'pour_b2',
  'few_last', 'few_n1', 'few_n2',
  'crank_1', 'crank_2', 'crank_3', 'crank_4',
  'wait_1', 'wait_2', 'wait_3',
  'rev_pre_1', 'rev_pre_2', 'rev_pre_3', 'rev_pre_4', 'rev_rep',
  'rev_out_1', 'rev_out_2', 'rev_out_3', 'rev_out_4',
  'ret_1', 'ret_2',
  'fin_1', 'fin_2',
  'poke_setup', 'poke_done', 'poke_1', 'poke_2', 'poke_3',
  'poke_lat_1', 'poke_lat_2', 'poke_lat_3',
];

/**
 * Converts integer 1..999 into an array of voice clip items `[{ key, gapAfter }]`
 * for full Thai cardinal reading (e.g. 24 -> ['u_yisip', 'd_4'], 101 -> ['d_1', 'u_roi', 'u_et']).
 */
export function numberToClipSteps(num) {
  const n = Math.floor(Math.abs(Number(num) || 0));
  if (n === 0) return [{ key: 'd_0', gapAfter: 0.02 }];
  if (n < 10) return [{ key: `d_${n}`, gapAfter: 0.02 }];

  const steps = [];
  let rem = n;

  if (rem >= 100) {
    const hundreds = Math.floor(rem / 100);
    steps.push({ key: `d_${hundreds}`, gapAfter: -0.025 });
    steps.push({ key: 'u_roi', gapAfter: -0.015 });
    rem %= 100;
  }

  if (rem >= 10) {
    const tens = Math.floor(rem / 10);
    if (tens === 1) {
      steps.push({ key: 'u_sip', gapAfter: -0.02 });
    } else if (tens === 2) {
      steps.push({ key: 'u_yisip', gapAfter: -0.02 });
    } else {
      steps.push({ key: `d_${tens}`, gapAfter: -0.025 });
      steps.push({ key: 'u_sip', gapAfter: -0.02 });
    }
    rem %= 10;
  }

  if (rem > 0) {
    if (rem === 1 && n > 10) {
      steps.push({ key: 'u_et', gapAfter: 0.02 });
    } else {
      steps.push({ key: `d_${rem}`, gapAfter: 0.02 });
    }
  } else if (steps.length > 0) {
    steps[steps.length - 1].gapAfter = 0.02;
  }

  return steps;
}

/**
 * Converts integer into digit-by-digit confirmation clip steps
 * (e.g. 7 -> ['w_mailaek', 'd_7'], 24 -> ['d_2', 'd_4']).
 */
export function numberToDigitRepeatSteps(num) {
  const clean = String(Math.floor(Math.abs(Number(num) || 0)));
  if (clean.length <= 1) {
    return [
      { key: 'w_mailaek', gapAfter: 0.01 },
      { key: `d_${clean}`, gapAfter: 0.14 },
    ];
  }
  const digits = clean.split('');
  return digits.map((d, idx) => ({
    key: `d_${d}`,
    gapAfter: idx === digits.length - 1 ? 0.15 : 0.07,
  }));
}
