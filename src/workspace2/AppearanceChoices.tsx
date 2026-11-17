import { Menu } from '@base-ui/react/menu';
import { Check, ChevronRight } from 'lucide-react';
import { appearanceChoices, appearanceWords, setAppearance, useAppearance, type Appearance } from './appearance';

/** "Studio Appearance" in the wide Project menu: a submenu of three radio items with a check on the current one. */
export function AppearanceSubmenu() {
  const appearance = useAppearance();
  return <Menu.SubmenuRoot>
    <Menu.SubmenuTrigger className="w2-menu-item w2-appearance-row">
      <span className="w2-menu-label">Studio Appearance</span><span className="w2-menu-summary">{appearanceWords(appearance)}</span><ChevronRight size={14} aria-hidden/>
    </Menu.SubmenuTrigger>
    <Menu.Portal><Menu.Positioner sideOffset={4} alignOffset={-6} className="w2-positioner"><Menu.Popup className="w2-scope w2-menu w2-appearance-menu" aria-label="Studio Appearance">
      <Menu.RadioGroup value={appearance} onValueChange={value => setAppearance(value as Appearance)}>
        {appearanceChoices.map(choice => <Menu.RadioItem key={choice} value={choice} closeOnClick className="w2-menu-item w2-appearance-item">
          <span className="w2-menu-check"><Menu.RadioItemIndicator><Check size={14} aria-hidden/></Menu.RadioItemIndicator></span>{appearanceWords(choice)}
        </Menu.RadioItem>)}
      </Menu.RadioGroup>
    </Menu.Popup></Menu.Positioner></Menu.Portal>
  </Menu.SubmenuRoot>;
}

/** The narrow sheet's row: the title and the current choice, pushing {@link AppearancePage}. */
export function AppearanceRow({ onOpen }: { onOpen: () => void }) {
  const appearance = useAppearance();
  return <button type="button" className="w2-list-row w2-appearance-row" onClick={onOpen}><span>Studio Appearance</span><span className="w2-summary">{appearanceWords(appearance)}</span><ChevronRight size={16} aria-hidden/></button>;
}

/** The page the narrow row pushes: the same three choices as radio rows. */
export function AppearancePage() {
  const appearance = useAppearance();
  return <ul className="w2-list" role="radiogroup" aria-label="Studio Appearance">{appearanceChoices.map(choice => <li key={choice}>
    <button type="button" role="radio" aria-checked={appearance === choice} className="w2-list-row" onClick={() => setAppearance(choice)}>
      <span>{appearanceWords(choice)}</span>{appearance === choice && <Check size={16} aria-hidden/>}
    </button></li>)}</ul>;
}
