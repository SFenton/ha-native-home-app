import { Link2 } from 'lucide-react';

/**
 * The tag a tree row carries for a place that uses a template: a 20 px square with the link glyph, in the tags slot before the count. The glyph,
 * not the tint, carries the meaning; the row's accessible name says "linked template", so the tag itself is hidden from assistive technology.
 */
export default function LinkedTag() {
  return <span className="w2-link-tag" aria-hidden="true" title="Linked template" data-testid="linked-tag"><Link2 size={12}/></span>;
}
