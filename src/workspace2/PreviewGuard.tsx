import { Component, type ReactNode } from 'react';
import type { CompositionDocument } from '../shared/composition/schema';

interface Props {
  /** The newest document: the preview draws it first, whatever the Checks say of it. */
  document: CompositionDocument;
  /** The last document that had no problems: drawn only when the newest one cannot be drawn at all. */
  lastGood: CompositionDocument | undefined;
  children: (document: CompositionDocument) => ReactNode;
}
interface State { failed?: CompositionDocument; fallbackFailed?: boolean }

/**
 * Holds the preview against a document it cannot draw. A problem the Checks find (a blank hint, a missing reference) never
 * holds the preview back, so the newest edit is always on screen; only a document that makes the renderer itself throw falls back
 * to the last document that had no problems, until the next edit gives the renderer something new to try.
 */
export default class PreviewGuard extends Component<Props, State> {
  state: State = {};
  componentDidCatch() {
    this.setState(state => state.failed === this.props.document ? { fallbackFailed: true } : { failed: this.props.document, fallbackFailed: false });
  }
  render() {
    const { document, lastGood, children } = this.props;
    if (this.state.failed !== document) return children(document);
    if (this.state.fallbackFailed || !lastGood || lastGood === document) return null;
    return children(lastGood);
  }
}
