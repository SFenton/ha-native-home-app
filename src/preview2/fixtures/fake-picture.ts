/**
 * A made-up camera still for the story page and the tests (`?picture=fake`): an SVG scene whose hue follows the entity id, so two cameras differ.
 * It stands in for `fetchPicture`, which reads Home Assistant's picture through the Studio's server; no network, no house data.
 */
export async function fakePicture(entityId: string): Promise<ArrayBuffer> {
  let hue = 0;
  for (const letter of entityId) hue = (hue * 31 + letter.charCodeAt(0)) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 45% 62%)"/><stop offset="1" stop-color="hsl(${hue} 35% 28%)"/></linearGradient></defs>
<rect width="400" height="300" fill="url(#g)"/><rect y="210" width="400" height="90" fill="hsl(${hue} 20% 22%)"/>
<rect x="60" y="120" width="110" height="130" fill="hsl(${hue} 25% 40%)"/><rect x="230" y="150" width="120" height="100" fill="hsl(${hue} 30% 48%)"/></svg>`;
  return new TextEncoder().encode(svg).buffer as ArrayBuffer;
}
