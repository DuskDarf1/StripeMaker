/* Reused from SignalMaker under GPL-3.0.
   See ../../LICENSE and the original SignalMaker project. Dimensions are inches. */
(() => {
  const app = window.StripeMakerSignalAssets;
  let sequence = 0;
  const uid = () => window.crypto?.randomUUID?.() ?? `signal-${Date.now()}-${++sequence}`;
  const isBusSymbol = symbol => Object.hasOwn(app.busAngles, symbol);
  const isWhiteDefaultSymbol = symbol => isBusSymbol(symbol) || symbol === 'triangle';
  const indicationColors = symbol => isWhiteDefaultSymbol(symbol)
    ? { white: 'White', red: 'Red', yellow: 'Yellow', green: 'Green' }
    : { red: 'Red', yellow: 'Yellow', green: 'Green' };
  const normalizePlateMargin = value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(8, value))) : 5;
  const normalizeReflectiveWidth = value => Number.isFinite(value) ? Math.round(Math.max(0, Math.min(3, value))) : 2;
  // An upright equilateral triangle with its circumcircle inside the lens.
  const trianglePoints = size => {
    const radius = size * 0.45;
    return [[0, -radius], [radius * Math.sqrt(3) / 2, radius / 2], [-radius * Math.sqrt(3) / 2, radius / 2]];
  };
  const indication = (color = 'red', symbol = 'ball', size = 12) => ({
    id: uid(), color: isWhiteDefaultSymbol(symbol) ? 'white' : color, symbol, size,
  });

  function setIndicationSymbol(section, symbol) {
    const hadWhiteDefault = isWhiteDefaultSymbol(section.symbol);
    section.symbol = symbol;
    if (isWhiteDefaultSymbol(symbol)) {
      if (!hadWhiteDefault) section.color = 'white';
    } else if (section.color === 'white') section.color = 'red';
  }

  function createHead(name) {
    return {
      id: uid(), name, orientation: 'vertical', cluster: false, fourCluster: null, dad: false, hawk: false, pedestrian: false, pedestrianDisplay: 'hand', housingColor: 'black', visor: 'three-quarter',
      backplate: 'reflective', backplateMargin: 5, reflectiveWidth: 2,
      backplateCorners: 'round', backplateFullRectangle: false, poleMounting: 'side',
      indications: [indication('red'), indication('yellow'), indication('green')],
    };
  }

  function setCluster(head, enabled) {
    if (enabled) { head.orientation = 'vertical'; head.dad = false; head.hawk = false; head.fourCluster = null; }
    if (enabled && head.indications.length === 3) {
      const [red, yellow, green] = head.indications;
      head.indications = [red, indication('yellow', 'left', yellow.size), yellow,
        indication('green', 'left', green.size), green];
    }
    while (enabled && head.indications.length < 5) {
      const defaults = [['red', 'ball'], ['yellow', 'left'], ['yellow', 'ball'], ['green', 'left'], ['green', 'ball']];
      const [color, symbol] = defaults[head.indications.length];
      head.indications.push(indication(color, symbol));
    }
    head.cluster = enabled;
  }

  function setHawk(head, enabled) {
    head.hawk = enabled;
    if (!enabled) return;
    head.cluster = false;
    head.dad = false;
    head.fourCluster = null;
    head.orientation = 'vertical';
    const colors = ['red', 'red', 'yellow'];
    head.indications = colors.map((color, index) => ({
      ...(head.indications[index] ?? indication()), color, symbol: 'ball',
    }));
  }

  function setFourCluster(head, side) {
    head.fourCluster = side;
    head.cluster = head.hawk = head.pedestrian = false;
    head.orientation = 'vertical';
    if (head.indications.length === 3) {
      const [red, yellow, green] = head.indications;
      head.indications = side === 'below'
        ? [red, yellow, indication('green', 'left', green.size), green]
        : [indication('red', 'left', red.size), red, yellow, green];
    }
    while (head.indications.length < 4) head.indications.push(indication('green'));
    head.indications = head.indications.slice(0, 4);
  }
  function setDad(head) {
    head.dad = true;
    head.cluster = head.hawk = head.pedestrian = false;
    head.fourCluster = null;
    head.orientation = 'vertical';
    head.indications = ['ball', 'left', 'right'].map((symbol, index) => ({
      ...(head.indications[index] ?? indication()), color: index ? 'yellow' : 'red', symbol,
    }));
  }
  function setHeadLayout(head, layout, support) {
    if (layout === 'pedestrian' && support?.type === 'pedestal') head.poleMounted = true;
    if (layout === 'dad') return setDad(head);
    const wasDad = head.dad;
    head.dad = false;
    if (wasDad) head.indications = ['red', 'yellow', 'green'].map(color => indication(color));
    if (layout === 'cluster-below' || layout === 'cluster-above') return setFourCluster(head, layout === 'cluster-below' ? 'below' : 'above');
    head.fourCluster = null;
    if (layout === 'pedestrian') {
      if (!head.poleMounted) return;
      head.pedestrian = true;
      head.cluster = head.hawk = false;
      head.orientation = 'vertical';
      head.backplate = 'none';
      return;
    }
    const wasPedestrian = head.pedestrian;
    head.pedestrian = false;
    if (wasPedestrian) head.indications = ['red', 'yellow', 'green'].map(color => indication(color));
    if (layout === 'hawk') return setHawk(head, true);
    if (layout === 'linear' && (head.cluster || head.hawk)) {
      head.indications = ['red', 'yellow', 'green'].map(color => indication(color));
      head.orientation = 'vertical';
    }
    setHawk(head, false);
    setCluster(head, layout === 'cluster');
  }

  function moveItem(items, fromIndex, dropIndex) {
    if (!Number.isInteger(fromIndex) || !Number.isInteger(dropIndex)
      || fromIndex < 0 || fromIndex >= items.length || dropIndex < 0 || dropIndex > items.length) return;
    const [item] = items.splice(fromIndex, 1);
    const index = dropIndex > fromIndex ? dropIndex - 1 : dropIndex;
    items.splice(index, 0, item);
    return index;
  }

  function restoreProject(raw) {
    const empty = { version: 1, spacing: 12, alignment: 'center', support: normalizeSupport(), heads: [], selectedId: null, streetSigns: [], selectedStreetSignId: null };
    try {
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || !Array.isArray(saved.heads)) return empty;
      let restoredSelection;
      const heads = saved.heads.filter(head => head && Array.isArray(head.indications)
        && head.indications.length >= 1 && head.indications.length <= 5).map(head => {
        const clean = createHead(typeof head.name === 'string' ? head.name.slice(0, 80) : 'Signal head');
        clean.orientation = head.orientation === 'horizontal' ? 'horizontal' : 'vertical';
        clean.housingColor = Object.hasOwn(app.housingColors, head.housingColor) ? head.housingColor : 'black';
        clean.backplate = ['none', 'plain', 'reflective'].includes(head.backplate) ? head.backplate : 'none';
        clean.backplateMargin = normalizePlateMargin(head.backplateMargin);
        clean.reflectiveWidth = normalizeReflectiveWidth(head.reflectiveWidth);
        clean.backplateCorners = head.backplateCorners === 'round' ? 'round' : 'sharp';
        clean.backplateFullRectangle = head.backplateFullRectangle === true;
        if (Number.isFinite(head.armPosition)) clean.armPosition = head.armPosition;
        clean.poleMounted = head.poleMounted === true;
        if (Number.isFinite(head.pedestalPosition)) clean.pedestalPosition = head.pedestalPosition;
        clean.poleMounting = ['direct', 'top'].includes(head.poleMounting) ? 'direct' : 'side';
        clean.poleMountSide = ['left', 'right'].includes(head.poleMountSide) ? head.poleMountSide
          : saved.support?.side === 'left' ? 'left' : 'right';
        clean.spanPole = head.spanPole === 'right' ? 'right' : 'left';
        clean.poleHeight = Number.isFinite(head.poleHeight) ? head.poleHeight : 120;
        clean.indications = head.indications.map(section => ({
          id: uid(), color: Object.hasOwn(app.colors, section?.color) ? section.color : isWhiteDefaultSymbol(section?.symbol) ? 'white' : 'red',
          symbol: Object.hasOwn(app.symbols, section?.symbol) ? section.symbol : 'ball',
          size: section?.size === 8 ? 8 : 12,
        }));
        clean.indications.forEach(section => setIndicationSymbol(section, section.symbol));
        clean.cluster = head.cluster === true && clean.indications.length === 5;
        if (clean.cluster) clean.orientation = 'vertical';
        if (['above', 'below'].includes(head.fourCluster)) setFourCluster(clean, head.fourCluster);
        if (head.hawk === true && clean.indications.length === 3) setHawk(clean, true);
        if (head.dad === true) setDad(clean);
        if (head.pedestrian === true && clean.poleMounted) {
          setHeadLayout(clean, 'pedestrian');
          clean.pedestrianDisplay = head.pedestrianDisplay === 'walk' ? 'walk' : 'hand';
        }
        if (head.id === saved.selectedId && !restoredSelection) restoredSelection = clean.id;
        return clean;
      });
      const project = { version: 1, heads, alignment: normalizeAlignment(saved.alignment), support: normalizeSupport(saved.support),
        selectedId: restoredSelection ?? heads[0]?.id ?? null,
        spacing: Number.isFinite(saved.spacing) ? Math.max(0, Math.min(240, saved.spacing)) : 12 };
      app.restoreStreetSigns?.(project, saved);
      if (hasSupport(project)) ensureArmPositions(project);
      return project;
    } catch { return empty; }
  }

  function normalizeAlignment(value) {
    return ['top', 'bottom'].includes(value) ? value : 'center';
  }

  function normalizeMastAngle(value) {
    return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(15, value)) * 5) / 5 : 0;
  }

  function normalizeMastBowAngle(value) {
    return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(20, value)) * 5) / 5 : 0;
  }

  function mastBowWidth(support) {
    const mast = app.dimensions.mast;
    const width = Number.isFinite(support.bowWidth) ? support.bowWidth
      : Math.min(mast.bowTransitionLength, support.length * mast.bowTransitionRatio);
    return Math.max(mast.minBowWidth, Math.min(support.length, width));
  }

  function setMastBowWidth(support, value) {
    support.bowWidth = mastBowWidth({ ...support, bowWidth: value });
  }

  function mastBowBounds(support) {
    const half = mastBowWidth(support) / 2;
    return { min: half, max: support.length - half };
  }

  function setMastBowPosition(support, value) {
    const { min, max } = mastBowBounds(support);
    support.bowPosition = Math.max(min, Math.min(max, Number.isFinite(value) ? value : support.length / 2));
  }

  function normalizeSupport(value) {
    const mast = app.dimensions.mast;
    const span = app.dimensions.span;
    const number = (key, min, max, fallback) => Number.isFinite(value?.[key]) ? Math.max(min, Math.min(max, value[key])) : fallback;
    const color = typeof value?.color === 'string' ? value.color.toLowerCase() : '';
    const support = { type: ['mast-arm', 'span-wire', 'pedestal'].includes(value?.type) ? value.type : 'none',
      length: Number.isFinite(value?.length) ? Math.max(mast.minLength, Math.min(mast.maxLength, value.length)) : mast.defaultLength,
      side: value?.side === 'right' ? 'right' : 'left',
      angle: normalizeMastAngle(value?.angle),
      bowAngle: normalizeMastBowAngle(value?.bowAngle),
      mastHeadAlignment: value?.mastHeadAlignment === 'arm-center' ? 'arm-center' : 'level',
      pedestalHeight: number('pedestalHeight', 48, 240, 120),
      spanLength: number('spanLength', span.minLength, span.maxLength, span.defaultLength),
      spanPostMaterial: value?.spanPostMaterial === 'concrete' ? 'concrete' : 'steel',
      leftPostHeight: number('leftPostHeight', span.minPostHeight, span.maxPostHeight, span.defaultPostHeight),
      rightPostHeight: number('rightPostHeight', span.minPostHeight, span.maxPostHeight, span.defaultPostHeight),
      leftPostWidth: number('leftPostWidth', span.minPostWidth, span.maxPostWidth, span.defaultPostWidth),
      rightPostWidth: number('rightPostWidth', span.minPostWidth, span.maxPostWidth, span.defaultPostWidth),
      color: ['#a9a9a9', '#252628', '#654321', '#c62828', '#3d4b35'].includes(color) ? color : '#a9a9a9' };
    setMastBowWidth(support, value?.bowWidth);
    setMastBowPosition(support, value?.bowPosition);
    return support;
  }

  const hasMast = project => project.support?.type === 'mast-arm';
  const hasSpan = project => project.support?.type === 'span-wire';
  const hasPedestal = project => project.support?.type === 'pedestal';
  const hasSupport = project => hasMast(project) || hasSpan(project) || hasPedestal(project);
  const headPosition = (head, support) => support.type === 'pedestal' ? head.pedestalPosition : head.poleMounted ? head.poleHeight : head.armPosition;
  const hasDrawing = project => hasSupport(project) || project.heads.length > 0 || project.streetSigns?.length > 0
    || Boolean(project.mastArms?.some(arm => ['mast-arm', 'span-wire', 'pedestal'].includes(arm.support?.type) || arm.heads?.length || arm.streetSigns?.length));
  const supportLength = support => support.type === 'span-wire' ? support.spanLength : support.length;
  function mastCurve(support) {
    const angle = normalizeMastAngle(support.angle);
    const bowAngle = normalizeMastBowAngle(support.bowAngle);
    const radians = angle * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    const { min, max } = mastBowBounds(support);
    const bowPosition = Math.max(min, Math.min(max, Number.isFinite(support.bowPosition) ? support.bowPosition : support.length / 2));
    const bendStart = bowPosition - min, bendEnd = bowPosition + min;
    const turn = -bowAngle * Math.PI / 180;
    const radius = bowAngle ? (bendEnd - bendStart) / turn : 0;
    const tipCos = Math.cos(radians + turn), tipSin = Math.sin(radians + turn);
    function arcAt(position) {
      const travel = position - bendStart;
      const sweep = travel / radius;
      const sinc = sweep ? Math.sin(sweep / 2) / (sweep / 2) : 1;
      return { x: bendStart * cos + travel * sinc * Math.cos(radians + sweep / 2),
// in #sm-links
// in #sm-links
        y: -bendStart * sin - travel * sinc * Math.sin(radians + sweep / 2),
        cos: Math.cos(radians + sweep), sin: Math.sin(radians + sweep) };
    }
    const end = bowAngle ? arcAt(bendEnd) : null;
    const at = position => {
      if (!bowAngle || position <= bendStart) return { x: position * cos, y: -position * sin, cos, sin };
      if (position < bendEnd) return arcAt(position);
      return { x: end.x + (position - bendEnd) * tipCos, y: end.y - (position - bendEnd) * tipSin, cos: tipCos, sin: tipSin };
    };
    const positionAtX = x => {
      if (!bowAngle || x <= bendStart * cos) return x / cos;
      if (x >= end.x) return bendEnd + (x - end.x) / tipCos;
      return bendStart + radius * (Math.asin(Math.max(-1, Math.min(1, sin + (x - bendStart * cos) / radius))) - radians);
    };
    return { angle, bowAngle, bowPosition, bowWidth: bendEnd - bendStart, bendStart, bendEnd, cos, sin, at, positionAtX };
  }

  const supportXAtPosition = (support, position) => support.type === 'mast-arm' ? mastCurve(support).at(position).x : position;
  const supportPositionAtX = (support, x) => support.type === 'mast-arm' ? mastCurve(support).positionAtX(x) : x;
  const supportProjectedLength = support => supportXAtPosition(support, supportLength(support));

  function supportPositionBounds(width, support) {
    const projected = supportProjectedLength(support);
    const half = width / 2;
    if (width > projected) {
      const center = supportPositionAtX(support, projected / 2);
      return { min: center, max: center };
    }
    return { min: supportPositionAtX(support, half), max: supportPositionAtX(support, projected - half) };
  }

  function armPositionBounds(head, support) {
    if (support.type === 'pedestal') {
      const half = headGeometry(head).height / 2;
      if ((head.poleMounted || head.pedestrian) && head.poleMounting === 'direct') {
        // Rear mounting may overlap the capped pole by two inches. This lets
        // the housing conceal its top entirely without a post-top fitter.
        return { min: half + 16, max: Math.max(half + 16, support.pedestalHeight + half - 2) };
      }
      // Primary heads sit above the capped pole on a schematic 6-inch fitter.
      // Supplementary and pedestrian heads use adjustable pole bands/brackets.
      return head.poleMounted || head.pedestrian
        ? { min: half + 16, max: Math.max(half + 16, support.pedestalHeight - half) }
        : { min: half + 16, max: support.pedestalHeight + 6 + half };
    }
    if (head.poleMounted && ['mast-arm', 'span-wire'].includes(support.type)) {
      const half = headGeometry(head).height / 2;
      const height = support.type === 'span-wire' ? support[head.spanPole === 'right' ? 'rightPostHeight' : 'leftPostHeight'] : app.dimensions.mast.poleHeight;
      const base = support.type === 'span-wire' && support.spanPostMaterial === 'concrete' ? 0 : app.dimensions.mast.baseThickness;
      return { min: half + base, max: Math.max(half + base, height - half) };
    }
    return supportPositionBounds(headGeometry(head).width, support);
  }

  function setArmPosition(head, support, position) {
    const { min, max } = armPositionBounds(head, support);
    head[support.type === 'pedestal' ? 'pedestalPosition' : head.poleMounted && ['mast-arm', 'span-wire'].includes(support.type) ? 'poleHeight' : 'armPosition'] = Math.max(min, Math.min(max, position));
  }

  function ensureArmPositions(project) {
    project.heads.forEach((head, index) => setArmPosition(head, project.support,
      hasPedestal(project) ? (head.pedestalPosition ?? armPositionBounds(head, project.support).max) : head.poleMounted && hasSupport(project) ? (head.poleHeight ?? 120) : Number.isFinite(head.armPosition) ? head.armPosition : supportLength(project.support) * (index + 1) / (project.heads.length + 1)));
  }

  function setPedestalHeight(project, height) {
    if (!Number.isFinite(height)) return;
    const next = Math.max(48, Math.min(240, height));
    const previous = project.support.pedestalHeight;
    // A head above the pole cap travels with its top fitter. Pole-mounted
    // accessories keep their own heights, clamping only when outside the pole.
    project.heads.filter(head => !head.poleMounted && !head.pedestrian && head.pedestalPosition > previous)
      .forEach(head => { head.pedestalPosition += next - previous; });
    project.support.pedestalHeight = next;
    if (hasPedestal(project)) {
      ensureArmPositions(project);
      app.ensureStreetSignPositions(project);
    }
  }

  function placeNewHead(project, head) {
    if (!hasSupport(project) || hasPedestal(project) || head.poleMounted) return;
    const { min, max } = armPositionBounds(head, project.support);
    const positions = project.heads.filter(other => !other.poleMounted && other !== head && Number.isFinite(other.armPosition))
      .map(other => Math.max(min, Math.min(max, other.armPosition))).sort((a, b) => a - b);
    const gaps = [min, ...positions, max];
    let best = { width: -1, position: (min + max) / 2 };
    for (let index = 1; index < gaps.length; index++) {
      const width = gaps[index] - gaps[index - 1];
      if (width > best.width) best = { width, position: (gaps[index] + gaps[index - 1]) / 2 };
    }
    setArmPosition(head, project.support, best.position);
  }

  function canSpaceHeadsEvenly(project, start = 0, end = supportLength(project.support)) {
    const heads = project.heads.filter(head => !hasSupport(project) || !head.poleMounted);
    return hasSupport(project) && !hasPedestal(project) && heads.length > 1
      && heads.reduce((width, head) => width + headGeometry(head).width, 0) <= supportXAtPosition(project.support, end) - supportXAtPosition(project.support, start);
  }

  function spaceHeadsEvenly(project, start = 0, end = supportLength(project.support)) {
    if (!canSpaceHeadsEvenly(project, start, end)) return false;
    const length = supportLength(project.support);
    const heads = project.heads.filter(head => !hasSupport(project) || !head.poleMounted).map((head, index) => ({ head, width: headGeometry(head).width,
      position: Number.isFinite(head.armPosition) ? head.armPosition : length * (index + 1) / (project.heads.length + 1) }))
      .sort((a, b) => a.position - b.position);
    const gap = (supportXAtPosition(project.support, end) - supportXAtPosition(project.support, start) - heads.reduce((width, item) => width + item.width, 0)) / (heads.length + 1);
    let edge = supportXAtPosition(project.support, start) + gap;
    heads.forEach(({ head, width }) => {
      setArmPosition(head, project.support, supportPositionAtX(project.support, edge + width / 2));
      edge += width + gap;
    });
    return true;
  }

  function mastGeometry(support) {
    const mast = app.dimensions.mast;
    const profile = mast.profiles.find(item => item.length >= support.length) ?? mast.profiles.at(-1);
    const poleX = profile.baseWidth / 2;
    const armY = mast.poleHeight - mast.armHeight;
    const poleBottom = mast.poleHeight - mast.baseThickness;
    const poleTopDiameter = profile.poleDiameter - mast.taperPerFoot * poleBottom / 12;
    const poleAtArm = profile.poleDiameter - mast.taperPerFoot * (mast.armHeight - mast.baseThickness) / 12;
    const armX = poleX + poleAtArm / 2 + 2;
    const armBaseDiameter = profile.armDiameter;
    // Requested schematic extension beyond 70 ft: retain the largest catalog
    // profile (18-inch arm above 70 ft), with a constant tube diameter through
    // 150 ft. Pole taper remains unchanged; no extrapolated FDOT profile.
    const armTipDiameter = support.length > mast.untaperedAboveLength ? armBaseDiameter
      : armBaseDiameter - mast.taperPerFoot * support.length / 12;
    const curve = mastCurve(support);
    const armAt = position => {
      const point = curve.at(position);
      return { ...point, x: armX + point.x, y: armY + point.y };
    };
    const tip = armAt(support.length);
    const curveSegments = Math.ceil(curve.bowAngle / 0.25);
    const positions = curve.bowAngle ? [0, curve.bendStart,
      ...Array.from({ length: curveSegments }, (_, index) => curve.bendStart + (curve.bendEnd - curve.bendStart) * (index + 1) / curveSegments), support.length] : [0, support.length];
    const samples = positions.map(position => ({ ...armAt(position), position,
      diameter: armBaseDiameter + (armTipDiameter - armBaseDiameter) * position / support.length }));
    return { ...profile, poleX, poleBottom, poleTopDiameter, armX, armY, armBaseDiameter, armTipDiameter,
      ...curve, armAt, samples, tip,
      top: Math.min(0, ...samples.map(point => point.y - point.diameter / 2 * point.cos), tip.y - armTipDiameter / 2 * tip.cos - 0.75 * Math.abs(tip.sin)),
      width: Math.max(...samples.map(point => point.x + point.diameter / 2 * Math.abs(point.sin))),
      height: Math.max(mast.poleHeight, ...samples.map(point => point.y + point.diameter / 2 * point.cos), tip.y + armTipDiameter / 2 * tip.cos + 0.75 * Math.abs(tip.sin)) };
  }

  function spanGeometry(support) {
    const dimensions = app.dimensions.span;
    const height = Math.max(support.leftPostHeight, support.rightPostHeight);
    const concrete = support.spanPostMaterial === 'concrete';
    const baseThickness = concrete ? 0 : app.dimensions.mast.baseThickness;
    const leftBaseWidth = support.leftPostWidth + (concrete ? 0 : 16);
    const rightBaseWidth = support.rightPostWidth + (concrete ? 0 : 16);
    const leftX = leftBaseWidth / 2;
    const leftTopY = height - support.leftPostHeight;
    const rightTopY = height - support.rightPostHeight;
    const taper = concrete ? dimensions.concreteTaperPerFoot : app.dimensions.mast.taperPerFoot;
    const leftTopWidth = support.leftPostWidth - taper * (support.leftPostHeight - baseThickness) / 12;
    const rightTopWidth = support.rightPostWidth - taper * (support.rightPostHeight - baseThickness) / 12;
    const spanX = leftX + leftTopWidth / 2 + 3;
    const rightX = spanX + support.spanLength + rightTopWidth / 2 + 3;
    const sag = dimensions.sagRatio * support.spanLength;
    const upperLeftY = leftTopY + dimensions.topClearance;
    const upperRightY = rightTopY + dimensions.topClearance;
    const upperAt = position => {
      const t = position / support.spanLength;
      return upperLeftY + (upperRightY - upperLeftY) * t + 4 * sag * t * (1 - t);
    };
    const lowerAt = position => upperLeftY + (upperRightY - upperLeftY) * position / support.spanLength + sag + dimensions.wireSeparation;
    return { leftX, rightX, leftTopY, rightTopY, leftTopWidth, rightTopWidth, leftBaseWidth, rightBaseWidth,
      spanX, sag, upperLeftY, upperRightY, upperAt, lowerAt, postBottom: height - baseThickness,
      width: rightX + rightBaseWidth / 2, height };
  }

  function headGeometry(head) {
    if (head.pedestrian) {
      const { width, height } = app.dimensions.pedestrian;
      return { sections: [], margin: 0, nativeWidth: width, width, height };
    }

    const horizontal = !head.cluster && !head.fourCluster && !head.dad && !head.hawk && head.orientation === 'horizontal';
    const sections = head.indications.map(section => ({ ...app.dimensions.housing[section.size], indication: section }));
    if (head.dad) {
      // DAD: a centered circular red above paired yellow left/right arrows.
      // TTI 0-7096-R2, Figures 38, 40 and 43 (US 83 field installation):
      // https://static.tti.tamu.edu/tti.tamu.edu/documents/0-7096-R2.pdf
      const rowHeight = Math.max(sections[1].height, sections[2].height);
      const pairWidth = sections[1].width + sections[2].width;
      sections[0].x = -sections[0].width / 2;
      sections[0].y = 0;
      sections[1].x = -pairWidth / 2;
      sections[2].x = sections[1].x + sections[1].width;
      for (const section of sections.slice(1)) section.y = sections[0].height + (rowHeight - section.height) / 2;
    } else if (head.hawk) {
      const rowHeight = Math.max(sections[0].height, sections[1].height);
      const redSpacing = (sections[0].width + sections[1].width) / 2;
      sections[0].x = -redSpacing / 2 - sections[0].width / 2;
      sections[1].x = redSpacing / 2 - sections[1].width / 2;
      for (let index = 0; index < 2; index++) sections[index].y = (rowHeight - sections[index].height) / 2;
      sections[2].x = -sections[2].width / 2;
      sections[2].y = rowHeight;
    } else if (head.fourCluster) {
      // Four physical sections: a two-wide row above/below two centered rows.
      // Mixed lens sizes share the pair's centerline and retain clear housings.
      const below = head.fourCluster === 'below';
      const pair = below ? sections.slice(2) : sections.slice(0, 2);
      const stem = below ? sections.slice(0, 2) : sections.slice(2);
      const pairHeight = Math.max(...pair.map(section => section.height));
      const center = (pair[1].width - pair[0].width) / 2;
      let y = below ? 0 : pairHeight;
      stem.forEach(section => { section.x = center - section.width / 2; section.y = y; y += section.height; });
      pair.forEach((section, index) => {
        section.x = index === 0 ? -section.width : 0;
        section.y = (below ? y : 0) + (pairHeight - section.height) / 2;
      });
    } else if (head.cluster) {
      const leftWidth = Math.max(sections[1].width, sections[3].width);
      const rightWidth = Math.max(sections[2].width, sections[4].width);
      const rowHeight = Math.max(sections[1].height, sections[2].height);
      sections[0].x = (rightWidth - leftWidth - sections[0].width) / 2;
      sections[0].y = 0;
      for (let index = 1; index < 5; index++) {
        const left = index % 2 === 1;
        const row = index < 3 ? 0 : 1;
        const height = row ? Math.max(sections[3].height, sections[4].height) : rowHeight;
        sections[index].x = (left ? -leftWidth / 2 : rightWidth / 2) - sections[index].width / 2;
        sections[index].y = sections[0].height + (row ? rowHeight : 0) + (height - sections[index].height) / 2;
      }
    } else {
      let y = 0;
      sections.forEach(section => { section.x = -section.width / 2; section.y = y; y += section.height; });
    }
    const minX = Math.min(...sections.map(section => section.x));
    const width = Math.max(...sections.map(section => section.x + section.width)) - minX;
    const height = Math.max(...sections.map(section => section.y + section.height));
    const margin = head.backplate === 'none' ? 0 : head.backplateMargin;
    sections.forEach(section => {
      section.x -= minX;
      section.nativeX = section.x;
      section.nativeY = section.y;
      section.nativeWidth = section.width;
      section.nativeHeight = section.height;
      if (horizontal) {
        const x = section.x;
        section.x = section.y;
        section.y = width - x - section.width;
        [section.width, section.height] = [section.height, section.width];
      }
      section.x += margin;
      section.y += margin;
      section.cx = section.x + section.width / 2;
      section.cy = section.y + section.height / 2;
    });
    return { sections, margin, nativeWidth: width,
      width: (horizontal ? height : width) + 2 * margin,
      height: (horizontal ? width : height) + 2 * margin };
  }

  function platePath(sections, margin, { rectangular = false, radius = 0 } = {}) {
    const rectangles = sections.map(section => ({ x: section.x - margin, y: section.y - margin,
      right: section.x + section.width + margin, bottom: section.y + section.height + margin }));
    if (rectangular) {
      const x = Math.min(...rectangles.map(rect => rect.x));
      const y = Math.min(...rectangles.map(rect => rect.y));
      const right = Math.max(...rectangles.map(rect => rect.right));
      const bottom = Math.max(...rectangles.map(rect => rect.bottom));
      return platePolygonPath([[x, y], [right, y], [right, bottom], [x, bottom]], radius);
    }
    const xs = [...new Set(rectangles.flatMap(rect => [rect.x, rect.right]))].sort((a, b) => a - b);
    const ys = [...new Set(rectangles.flatMap(rect => [rect.y, rect.bottom]))].sort((a, b) => a - b);
    const occupied = (x, y) => x >= 0 && y >= 0 && x < xs.length - 1 && y < ys.length - 1
      && rectangles.some(rect => (xs[x] + xs[x + 1]) / 2 > rect.x && (xs[x] + xs[x + 1]) / 2 < rect.right
        && (ys[y] + ys[y + 1]) / 2 > rect.y && (ys[y] + ys[y + 1]) / 2 < rect.bottom);
    const edges = new Map();
    const edge = (x1, y1, x2, y2) => edges.set(`${x1},${y1}`, [x2, y2]);
    for (let x = 0; x < xs.length - 1; x++) for (let y = 0; y < ys.length - 1; y++) {
      if (!occupied(x, y)) continue;
      if (!occupied(x, y - 1)) edge(xs[x], ys[y], xs[x + 1], ys[y]);
      if (!occupied(x + 1, y)) edge(xs[x + 1], ys[y], xs[x + 1], ys[y + 1]);
      if (!occupied(x, y + 1)) edge(xs[x + 1], ys[y + 1], xs[x], ys[y + 1]);
      if (!occupied(x - 1, y)) edge(xs[x], ys[y + 1], xs[x], ys[y]);
    }
    let result = '';
    while (edges.size) {
      const start = edges.keys().next().value;
      let current = start;
      const points = [start.split(',').map(Number)];
      do {
        const next = edges.get(current);
        if (!next) break;
        edges.delete(current);
        current = next.join(',');
        if (current !== start) points.push(next);
      } while (current !== start);
      result += platePolygonPath(points, radius);
    }
    return result;
  }

  function platePolygonPath(points, radius) {
    const vertices = points.filter((point, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      return (point[0] - previous[0]) * (next[1] - point[1])
        - (point[1] - previous[1]) * (next[0] - point[0]) !== 0;
    });
    if (!radius) return `M${vertices[0]} ${vertices.slice(1).map(point => `L${point}`).join(' ')} Z `;
    const corners = vertices.map((point, index) => {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const next = vertices[(index + 1) % vertices.length];
      const incoming = [point[0] - previous[0], point[1] - previous[1]];
      const outgoing = [next[0] - point[0], next[1] - point[1]];
      const before = Math.hypot(...incoming);
      const after = Math.hypot(...outgoing);
      const convex = incoming[0] * outgoing[1] - incoming[1] * outgoing[0] > 0;
      const r = convex ? Math.min(radius, before / 2, after / 2) : 0;
      return { r, convex, entry: point.map((value, axis) => value - incoming[axis] * r / before),
        exit: point.map((value, axis) => value + outgoing[axis] * r / after) };
    });
    return `M${corners[0].entry} ${corners.map(({ r, convex, exit }, index) =>
      `${index ? `L${corners[index].entry} ` : ''}${r ? `A${r},${r} 0 0 ${convex ? 1 : 0} ${exit}` : `L${exit}`}`).join(' ')} Z `;
  }

  function backplatePath(head, geometry, inset = 0) {
    const rounded = head.backplateCorners === 'round';
    inset = Math.max(0, Math.min(geometry.margin, inset));
    return platePath(geometry.sections, geometry.margin - inset, {
      rectangular: (head.dad || head.hawk || head.fourCluster || head.indications.length === 5) && head.backplateFullRectangle === true,
      radius: rounded ? Math.max(0, 2 - inset) : 0,
    });
  }

  function arrowPoints() {
    const arrow = app.dimensions.arrow;
    const arm = arrow.armLength / Math.SQRT2;
    const inset = arrow.stroke / Math.SQRT2;
    const tip = -arrow.height / 2;
    const end = tip + arm;
    return [[0, tip], [arm, end], [arm - inset, end + inset], [0, tip + 2 * inset],
      [-arm + inset, end + inset], [-arm, end]];
  }

  function symbolDimensions(section) {
    const scale = section.size / 12;
    if (isBusSymbol(section.symbol)) {
      const bus = app.dimensions.bus;
      const angle = app.busAngles[section.symbol] * Math.PI / 180;
      const sin = Math.abs(Math.sin(angle)), cos = Math.abs(Math.cos(angle));
      const factor = section.size / bus.referenceDiameter;
      return { width: (bus.width * cos + bus.length * sin) * factor,
        height: (bus.length * cos + bus.width * sin) * factor };
    }
    if (section.symbol === 'ball') return { width: section.size, height: section.size };
    if (section.symbol === 'triangle') return { width: section.size * 0.45 * Math.sqrt(3), height: section.size * 0.675 };
    if (section.symbol === 'bicycle') {
      const bicycle = app.dimensions.bicycle;
      return { width: bicycle.width * scale, height: bicycle.height * scale, stroke: bicycle.stroke * scale };
    }
    if (section.symbol === 'u-turn') {
      const uTurn = app.dimensions.uTurn;
      const referenceScale = section.size / uTurn.referenceDiameter;
      return { width: uTurn.width * referenceScale, height: uTurn.height * referenceScale,
        stroke: uTurn.stroke * referenceScale };
    }
    const arrow = app.dimensions.arrow;
    const angle = app.arrowAngles[section.symbol] * Math.PI / 180;
    const points = [...arrowPoints(), ...[-1, 1].flatMap(side =>
      [arrow.shaftTop, arrow.shaftBottom].map(y => [side * arrow.stroke / 2, y]))]
      .map(([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)]);
    return { width: (Math.max(...points.map(point => point[0])) - Math.min(...points.map(point => point[0]))) * scale,
      height: (Math.max(...points.map(point => point[1])) - Math.min(...points.map(point => point[1]))) * scale,
      stroke: arrow.stroke * scale };
  }

  Object.assign(app, { createHead, createIndication: indication, isBusSymbol, isWhiteDefaultSymbol, indicationColors, normalizePlateMargin, normalizeReflectiveWidth, trianglePoints, setIndicationSymbol, setCluster, setHawk, setHeadLayout, moveItem, restoreProject, normalizeAlignment,
    normalizeMastAngle, normalizeMastBowAngle, mastBowWidth, setMastBowWidth, mastBowBounds, setMastBowPosition, normalizeSupport, hasMast, hasSpan, hasPedestal, headPosition, setPedestalHeight, hasSupport, hasDrawing, supportLength,
    mastCurve, supportXAtPosition, supportPositionAtX, supportProjectedLength, supportPositionBounds,
    armPositionBounds, setArmPosition, ensureArmPositions, placeNewHead, canSpaceHeadsEvenly, spaceHeadsEvenly, mastGeometry, spanGeometry,
    headGeometry, platePath, backplatePath, arrowPoints, symbolDimensions,
    displayName: head => head.name.trim() || 'Untitled head',
    escape: value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])),
  });
})();
