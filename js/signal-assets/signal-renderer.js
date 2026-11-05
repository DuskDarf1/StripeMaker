/* Reused from SignalMaker under GPL-3.0.
   See ../../LICENSE and the original SignalMaker project. Dimensions are inches. */
(() => {
  const app = window.StripeMakerSignalAssets;

  function symbol(section, cx, cy) {
    const scale = section.size / 12;
    const color = section.lit === false ? "#142022" : app.colors[section.color];
    if (app.isBusSymbol(section.symbol)) {
      const bus = app.dimensions.bus;
      return `<g transform="translate(${cx} ${cy}) rotate(${app.busAngles[section.symbol]}) scale(${section.size / bus.referenceDiameter})" fill="${color}">
        <rect x="${-bus.width / 2}" y="${-bus.length / 2}" width="${bus.width}" height="${bus.length}"/>
      </g>`;
    }
    if (section.symbol === 'ball') return `<circle cx="${cx}" cy="${cy}" r="${section.size / 2}" fill="${color}"/>`;
    if (section.symbol === 'triangle') {
      const points = app.trianglePoints(section.size).map(([x, y]) => `${cx + x},${cy + y}`).join(' ');
      return `<polygon points="${points}" fill="${color}"/>`;
    }
    if (section.symbol === 'bicycle') {
      const radius = app.dimensions.bicycle.wheelOuterRadius - app.dimensions.bicycle.stroke / 2;
      return `<g transform="translate(${cx - app.dimensions.bicycle.width / 2 * scale} ${cy - app.dimensions.bicycle.height / 2 * scale}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${app.dimensions.bicycle.stroke}" stroke-linejoin="round" stroke-linecap="round">
        <circle cx="1.6875" cy="3.3125" r="${radius}"/><circle cx="7.3125" cy="3.3125" r="${radius}"/>
        <path d="M1.6875 3.3125 L3.3 0.95 L4.2 3.6 Z M3.3 1.1 H6.05 L4.2 3.6 M7.3125 3.3125 Q6.55 2.9 6.05 1.1 L5.7 0.55 L5.96 0.3 L5.83 0.15625 H5.2 M2.86 0.53 L4.04 0.61 L3.3 0.79 M4.2 3.6 L4.05 4.55 H3.9 M4.2 3.6 L4.35 2.65 H4.5"/>
      </g>`;
    }
    if (section.symbol === 'u-turn') {
      const uTurn = app.dimensions.uTurn;
      return `<g transform="translate(${cx} ${cy}) scale(${section.size / uTurn.referenceDiameter})" fill="none" stroke="${color}" stroke-width="${uTurn.stroke}" stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="4">
        <path d="${uTurn.path}"/>
      </g>`;
    }
    const arrow = app.dimensions.arrow;
    const points = app.arrowPoints().map(point => point.join(',')).join(' ');
    return `<g transform="translate(${cx} ${cy}) rotate(${app.arrowAngles[section.symbol]}) scale(${scale})" fill="${color}">
      <polygon points="${points}"/><rect x="${-arrow.stroke / 2}" y="${arrow.shaftTop}" width="${arrow.stroke}" height="${arrow.shaftBottom - arrow.shaftTop}"/>
    </g>`;
  }

  function headMarkup(head, geometry) {
    const color = app.housingColors[head.housingColor];
    if (head.pedestrian) {
      const ped = app.dimensions.pedestrian;
      const walk = head.pedestrianDisplay === 'walk';
      const paths = walk ? ped.walk : [ped.hand];
      // Twelve-inch symbols share a left edge, leaving room for a countdown.
      // Bounds come from the extracted MUTCD paths; keep their proportions.
      const tx = walk ? 453.472656 : 450.95;
      const ty = walk ? 598.798828 : 535.761719;
      const symbolHeight = walk ? 38.917968 : 38.914062;
      const { width, height } = ped;
      return `<rect width="${width}" height="${height}" rx="0.65" fill="${color}" stroke="#151618" stroke-width="0.15"/>
        <rect x="0.45" y="0.45" width="${width - 0.9}" height="${height - 0.9}" rx="0.5" fill="none" stroke="#000" stroke-width="0.15"/>
        <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="0.3" fill="#080b0c"/>
        <path d="M1 ${height - 1} V1 H${width - 1} V${height - 1}" fill="none" stroke="#0c0e10" stroke-width="0.35"/>
        <g transform="translate(2.5 ${height / 2}) scale(${12 / symbolHeight}) translate(${-tx} ${-ty})" fill="${walk ? '#fff' : '#f7921e'}">${paths.map(d => `<path d="${d}" fill-rule="evenodd"/>`).join('')}</g>`;
    }
    let markup = '';
    if (head.backplate !== 'none') {
      const outer = app.backplatePath(head, geometry);
      markup += `<path d="${outer}" fill="#17181a"/>`;
      if (head.backplate === 'reflective' && head.reflectiveWidth > 0 && geometry.margin > 0) {
        markup += `<path d="${outer} ${app.backplatePath(head, geometry, head.reflectiveWidth)}" fill="#e6ee37" fill-rule="evenodd"/>`;
      }
    }
    for (const section of geometry.sections) {
      const size = section.indication.size;
      const width = section.nativeWidth;
      const height = section.nativeHeight;
      const face = section.faceWidth;
      const inset = (width - face) / 2;
      const transform = !head.cluster && !head.fourCluster && !head.dad && !head.hawk && head.orientation === 'horizontal'
        ? `translate(${section.x} ${section.y + section.height}) rotate(-90)` : `translate(${section.x} ${section.y})`;
      markup += `<g transform="${transform}">
        <rect x="${inset}" y="0" width="${face}" height="${height}" rx="0.65" fill="${color}" stroke="#151618" stroke-width="0.12"/>
        <rect x="${inset + 0.22}" y="0.25" width="${face - 0.44}" height="${height - 0.5}" rx="0.5" fill="none" stroke="#000" stroke-opacity="0.35" stroke-width="0.1"/>`;
      for (const y of [height * 0.22, height * 0.78]) {
        markup += `<rect x="0" y="${y - 0.45}" width="${inset + 0.2}" height="0.9" rx="0.12" fill="${color}" stroke="#161719" stroke-width="0.08"/>
          <rect x="${width - inset - 0.2}" y="${y - 0.35}" width="${inset + 0.2}" height="0.7" rx="0.12" fill="#55575b"/>`;
      }
      markup += '</g>';
      markup += `<circle cx="${section.cx}" cy="${section.cy}" r="${size / 2 + 0.24}" fill="#090b0c"/>
        <circle cx="${section.cx}" cy="${section.cy}" r="${size / 2}" fill="#111719"/>`;
      markup += symbol(section.indication, section.cx, section.cy);
      const radius = size / 2 + 0.36;
      const dx = radius / Math.SQRT2;
      const y = section.cy + dx;
      markup += `<path class="signalVisor" d="M${section.cx - dx} ${y} A${radius} ${radius} 0 1 1 ${section.cx + dx} ${y}" fill="none" stroke="#0c0e10" stroke-width="0.35"/>`;
    }
    return markup;
  }

  Object.assign(app, { headMarkup, symbol });
})();
