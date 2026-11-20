// Use integer arithmetic so decimal dimensions round like Python Decimal.
function calculateStaticEstimate(data) {
  const scale = 100000000n;
  const areaUnit = 10000n * scale * scale;
  function parseDimension(value) {
    const [whole, fraction = ''] = value.trim().replace(',', '.').split('.');
    return BigInt(whole) * scale + BigInt(fraction.padEnd(8, '0'));
  }
  const area = parseDimension(data.width) * parseDimension(data.height);
  const billableArea = area > areaUnit ? area : areaUnit;
  const divisor = areaUnit * 100n;
  const numerator = billableArea * BigInt(staticPricing.rates[data.category])
    * BigInt(staticPricing.materials[data.material]);
  const rounded = (numerator + divisor / 2n) / divisor;
  return Number(rounded) + (data.installation ? staticPricing.installation : 0);
}
