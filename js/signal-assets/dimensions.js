/* Reused from SignalMaker under GPL-3.0.
   See ../../LICENSE and the original SignalMaker project. Dimensions are inches. */
window.StripeMakerSignalAssets = {
  dimensions: {
    // MUTCD 11th Edition Figure 4I-1 (PDF page 76 / printed 718),
    // unmodified vector paths extracted with pdftocairo. APL 653-024-002:
    // MoboTrex SG7SZ20C3FFF10-21, nominal 16 x 18 die-cast housing.
    // Face inset, door rim and visor depth are schematic, not shop dimensions.
    // Display envelope enlarged to 20 x 18 inches; APL nominal size above is the reference.
    pedestrian: { width: 20, height: 18, hand: "M 453.113281 555.21875 C 453.472656 554.78125 453.886719 554.308594 453.925781 553.539062 L 453.925781 547.910156 C 453.925781 545.457031 453.097656 545.039062 452.292969 544.289062 C 450.957031 543.046875 451.15625 541.289062 451.230469 539.015625 C 451.4375 532.722656 451.671875 528.929688 451.699219 523.042969 C 451.699219 522.292969 452.308594 521.683594 453.058594 521.683594 C 453.808594 521.683594 454.421875 522.292969 454.421875 523.042969 L 454.886719 532.59375 L 455.507812 532.574219 C 455.605469 528.214844 455.804688 523.816406 455.804688 519.457031 C 455.804688 518.707031 456.417969 518.097656 457.167969 518.097656 C 457.914062 518.097656 458.527344 518.707031 458.527344 519.457031 C 458.527344 519.46875 458.527344 519.484375 458.53125 519.496094 L 458.71875 532.589844 L 459.351562 532.589844 C 459.527344 527.648438 459.878906 522.597656 459.878906 517.664062 C 459.878906 516.914062 460.492188 516.304688 461.238281 516.304688 C 461.988281 516.304688 462.601562 516.914062 462.601562 517.664062 L 462.601562 517.683594 L 462.894531 532.589844 L 463.71875 532.589844 C 463.769531 528.1875 463.816406 523.789062 463.867188 519.386719 C 463.894531 518.664062 464.503906 518.097656 465.226562 518.097656 C 465.960938 518.097656 466.570312 518.6875 466.585938 519.425781 L 467.261719 536.984375 C 467.253906 537.308594 467.542969 537.546875 467.867188 537.546875 C 468.054688 537.546875 468.472656 537.414062 468.796875 536.917969 L 471.875 532.457031 C 473.042969 530.824219 474.59375 530.5 476.417969 531.1875 C 475.289062 533.3125 472.957031 538.550781 470.59375 541.488281 C 469.34375 543.4375 465.164062 545.390625 465.164062 547.898438 L 465.164062 553.03125 C 465.164062 554.089844 466.207031 555.285156 466.160156 555.21875 Z M 453.113281 555.21875 ", walk: ["M 465.496094 579.339844 C 463.929688 579.339844 462.648438 580.617188 462.648438 582.183594 C 462.648438 583.753906 463.929688 585.035156 465.496094 585.035156 C 467.066406 585.035156 468.34375 583.753906 468.34375 582.183594 C 468.34375 580.617188 467.066406 579.339844 465.496094 579.339844 ", "M 474.121094 597.292969 L 468.144531 593.3125 C 467.871094 592.144531 466.722656 586.964844 464.425781 585.765625 C 462.152344 584.257812 453.757812 590.441406 453.710938 590.492188 L 453.710938 599.507812 L 455.53125 599.191406 L 456.242188 591.992188 C 456.925781 591.855469 457.613281 591.71875 458.296875 591.582031 C 456.800781 595.453125 456.25 599.1875 457.113281 601.644531 L 453.472656 616.515625 L 455.925781 618.257812 L 461.226562 604.492188 L 463.675781 607.101562 L 467.078125 617.464844 L 470.320312 616.277344 L 467.394531 605.363281 L 463.992188 599.273438 L 465.296875 594.777344 L 466.683594 596.582031 L 473.171875 598.71875 Z M 474.121094 597.292969 "] },
    housing: {
      8: { width: 10, height: 10, depth: 6.625, faceWidth: 9.3 },
      12: { width: 15.25, height: 14, depth: 7.75, faceWidth: 14 },
    },
    arrow: { armLength: 6.75, stroke: 0.94, height: 10, shaftTop: -1, shaftBottom: 5 },
    uTurn: {
      referenceDiameter: 17.078, width: 13.652507, height: 11.783714, stroke: 1.395,
      path: 'M-6.8749 -0.2696 L-1.7009 4.9044 L3.4731 -0.2696 '
        + 'M-1.7011 1.3946 L-1.7011 -1.5484 C-1.7011 -3.5624 -0.0691 -5.1954 1.9419 -5.1954 '
        + 'C3.9559 -5.1954 5.5869 -3.5624 5.5869 -1.5484 L5.5869 3.1736',
    },
    bicycle: { width: 9, height: 5, wheelOuterRadius: 1.6875, stroke: 0.3125 },
    bus: { referenceDiameter: 44, length: 30.668, width: 6.666 },
    mast: {
      minLength: 120, maxLength: 1800, defaultLength: 480, taperPerFoot: 0.14,
      untaperedAboveLength: 840,
      minBowWidth: 12, bowTransitionLength: 48, bowTransitionRatio: 0.2,
      poleHeight: 300, armHeight: 264, baseThickness: 2.5,
      profiles: [
        { length: 360, armDiameter: 11, poleDiameter: 16, baseWidth: 32, connectionHeight: 22 },
        { length: 480, armDiameter: 13, poleDiameter: 18, baseWidth: 34, connectionHeight: 22 },
        { length: 600, armDiameter: 14, poleDiameter: 20, baseWidth: 36, connectionHeight: 22 },
        { length: 720, armDiameter: 15, poleDiameter: 22, baseWidth: 38, connectionHeight: 30 },
        { length: 840, armDiameter: 17, poleDiameter: 24, baseWidth: 40, connectionHeight: 30 },
        { length: 936, armDiameter: 18, poleDiameter: 26, baseWidth: 42, connectionHeight: 30 },
      ],
    },
    span: {
      minLength: 120, maxLength: 3000, defaultLength: 960,
      minPostHeight: 180, maxPostHeight: 600, defaultPostHeight: 360,
      minPostWidth: 12, maxPostWidth: 36, defaultPostWidth: 18,
      sagRatio: 0.05, topClearance: 12, wireSeparation: 12, mountGap: 8,
      concreteTaperPerFoot: 0.162, concreteChamfer: 0.75,
    },
  },
  colors: { red: '#ff3028', yellow: '#ffbf00', green: '#00df99', white: '#ffffff' },
  busAngles: { 'bus-stop': 90, 'bus-straight': 0, 'bus-left': -45, 'bus-right': 45 },
  housingColors: { black: '#252628', yellow: '#e9b82a', green: '#3d4b35' },
  arrowAngles: { up: 0, right: 90, down: 180, left: -90, 'up-left': -45, 'up-right': 45 },
  symbols: {
    ball: 'Circular', left: 'Left arrow', right: 'Right arrow', up: 'Up arrow',
    down: 'Down arrow', 'up-left': 'Up-left arrow', 'up-right': 'Up-right arrow',
    'u-turn': 'U-turn arrow', bicycle: 'Bicycle',
    'bus-stop': 'Bus stop', 'bus-straight': 'Bus go straight',
    'bus-left': 'Bus go left', 'bus-right': 'Bus go right',
    triangle: 'Triangle',
  },
};
