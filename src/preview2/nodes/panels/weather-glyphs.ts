/** The weather glyphs of the atlas kit (`WeatherGlyph`), multicolour like Apple Weather, as SVG markup for a 52.8 x 50.3 viewBox. */
export const weatherGlyphs: Record<string, string> = {
  "partly-cloudy": "<g stroke=\"#FFD93D\" stroke-width=\"4.5\" stroke-linecap=\"round\"><path d=\"M40 6v6M55 13l-4 4M60 28h-6M24 13l4 4M55 43l-4-4\"/></g><circle cx=\"40\" cy=\"28\" r=\"12\" fill=\"#FFD93D\"/><path d=\"M18 54h24a10 10 0 0 0 1.4-19.9A14 14 0 0 0 16.6 37 8.5 8.5 0 0 0 18 54z\" fill=\"#fff\"/>",
  "sunny": "<g stroke=\"#FFD93D\" stroke-width=\"5\" stroke-linecap=\"round\" transform=\"translate(9.500 3.700) scale(.82)\"><path d=\"M32 4v8M32 52v8M4 32h8M52 32h8M12 12l6 6M46 46l6 6M12 52l6-6M46 18l6-6\"/></g><circle cx=\"36\" cy=\"30\" r=\"11\" fill=\"#FFD93D\"/>",
  "cloudy": "<path d=\"M16 48h30a11 11 0 0 0 1.500-21.900A16 16 0 0 0 16 29 9.500 9.500 0 0 0 16 48z\" fill=\"#E4E8EE\"/><path d=\"M12 42h22a9 9 0 0 0 1.200-17.900A13 13 0 0 0 12 26a8 8 0 0 0 0 16z\" fill=\"#fff\" transform=\"translate(10 4)\"/>",
  "rain": "<path d=\"M18 40h26a10 10 0 0 0 1.400-19.900A14 14 0 0 0 16.600 23 8.500 8.500 0 0 0 18 40z\" fill=\"#DDE3EA\"/><g stroke=\"#5AB2FF\" stroke-width=\"4\" stroke-linecap=\"round\"><path d=\"M22 46l-3 7M32 46l-3 7M42 46l-3 7\"/></g>",
  "storm": "<path d=\"M18 38h26a10 10 0 0 0 1.400-19.900A14 14 0 0 0 16.600 21 8.500 8.500 0 0 0 18 38z\" fill=\"#9AA5B5\"/><path d=\"M33 38l-7 10h6l-3 8 10-12h-6l3-6z\" fill=\"#FFD93D\"/>",
  "snow": "<path d=\"M18 40h26a10 10 0 0 0 1.400-19.900A14 14 0 0 0 16.600 23 8.500 8.500 0 0 0 18 40z\" fill=\"#E4E8EE\"/><g fill=\"#fff\"><circle cx=\"22\" cy=\"48\" r=\"2.600\"/><circle cx=\"32\" cy=\"52\" r=\"2.600\"/><circle cx=\"42\" cy=\"48\" r=\"2.600\"/></g>",
  "clear-night": "<path d=\"M44 40A18 18 0 0 1 28 10a18 18 0 1 0 16 30z\" fill=\"#E9E4FF\"/><g fill=\"#fff\"><circle cx=\"46\" cy=\"14\" r=\"1.800\"/><circle cx=\"52\" cy=\"26\" r=\"1.300\"/></g>",
};
