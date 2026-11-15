/**
 * A test seam: `onNode` runs each time a node's frame renders, so a test can prove an edit to one title re-renders that
 * node and not its siblings. Nothing sets it in the app.
 */
export const renderProbe: { onNode?: (id: string) => void } = {};
