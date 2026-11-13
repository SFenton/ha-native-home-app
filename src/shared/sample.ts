import type { Component, Json, Page, StudioDocument } from './types';

function item(id: string, type: Component['type'], title: string, extra: Partial<Component> = {}): Component {
  return { id, type, title, props: {}, ...extra };
}

function page(id: string, title: string, icon: string, components: Component[]): Page {
  return { id, title, icon, layout: { columns: 2, gap: 12 }, components, toolbar: [] };
}

export function createSampleDocument(): StudioDocument {
  const categories: Json = [
    { id: 'produce', title: 'Produce', icon: 'Carrot', color: '#54865c', count: 4 },
    { id: 'dairy', title: 'Dairy & eggs', icon: 'Milk', color: '#c2975d', count: 2 },
    { id: 'pantry', title: 'Pantry', icon: 'ShoppingBasket', color: '#b67c5d', count: 6 },
    { id: 'frozen', title: 'Frozen', icon: 'Snowflake', color: '#739bae', count: 1 },
  ];
  return {
    schemaVersion: '1.0',
    id: 'native-home',
    name: 'Our home',
    theme: { accent: '#dd784e', appearance: 'light', fontScale: 1 },
    navigation: {
      initialPageId: 'home',
      tabs: [
        { id: 'tab-home', label: 'Home', icon: 'House', pageId: 'home' },
        { id: 'tab-food', label: 'Food', icon: 'CookingPot', pageId: 'food' },
        { id: 'tab-chores', label: 'Chores', icon: 'CircleCheck', pageId: 'chores' },
        { id: 'tab-settings', label: 'Settings', icon: 'Settings', pageId: 'settings' },
      ],
    },
    variables: { guestMode: false, showCameras: true, notifications: true, choreComplete: false, groceryMode: false },
    dataSources: [
      { id: 'household', name: 'Household profile', kind: 'static', refreshSeconds: 300, sample: { name: 'Sam', household: 'Maple House', initials: 'ST', greeting: 'Good evening', location: 'Home' } },
      { id: 'climate', name: 'Living room temperature', kind: 'ha-state', entityId: 'sensor.demo_living_room_temperature', refreshSeconds: 30, sample: { state: '21.5', unit: '\u00b0C', name: 'Living room' } },
      { id: 'food-categories', name: 'Suggested food categories', kind: 'static', refreshSeconds: 300, sample: categories },
      { id: 'groceries', name: 'Shopping list', kind: 'static', refreshSeconds: 60, sample: [
        { id: 'eggs', title: 'Free-range eggs', subtitle: 'Dairy & eggs', checked: false },
        { id: 'apples', title: 'Apples', subtitle: 'Produce', checked: false },
        { id: 'coffee', title: 'Coffee beans', subtitle: 'Pantry', checked: true },
      ] },
      { id: 'chores', name: 'Household chores', kind: 'static', refreshSeconds: 60, sample: [
        { id: 'plants', title: 'Water the plants', subtitle: 'Sam \u00b7 Today', checked: false },
        { id: 'bins', title: 'Take out recycling', subtitle: 'Alex \u00b7 Tomorrow', checked: false },
        { id: 'kitchen', title: 'Reset the kitchen', subtitle: 'Everyone \u00b7 Daily', checked: true },
      ] },
      { id: 'laundry', name: 'Laundry activity', kind: 'static', refreshSeconds: 30, sample: { title: 'Laundry', status: 'Rinse cycle', remaining: '18 min', progress: 0.7 } },
    ],
    pages: [
      {
        ...page('home', 'Home', 'House', [
          item('home-welcome', 'heading', 'Welcome home, Sam', { subtitle: 'A little calmer. A little more connected.', layout: { span: 2 } }),
          item('home-summary', 'section', 'At a glance', { layout: { span: 2 }, children: [
            item('home-temp', 'status-chip', 'Living room', { icon: 'Thermometer', binding: { sourceId: 'climate', path: 'state' }, props: { suffix: ' \u00b0C', value: '21.5 \u00b0C' } }),
            item('home-safe', 'status-chip', 'All secure', { icon: 'ShieldCheck', props: { value: 'Doors locked', tone: 'success' } }),
          ] }),
          item('home-shortcuts', 'tile-grid', 'Your home', { layout: { span: 2 }, props: { columns: 2 }, children: [
            item('home-lights', 'action-tile', 'Evening lights', { subtitle: 'Settle in for the night', icon: 'Lamp', color: '#e5b367', action: { type: 'service', domain: 'light', service: 'turn_on', entityId: 'light.demo_living_room', data: { brightness_pct: 45 } } }),
            item('home-cameras', 'camera-button', 'Front door', { subtitle: 'Open camera', icon: 'Camera', visibility: { source: 'variable', key: 'showCameras', operator: 'truthy' }, action: { type: 'modal', modalId: 'camera' } }),
            item('home-food', 'navigation-tile', 'What is for dinner?', { subtitle: 'Food & shopping', icon: 'CookingPot', action: { type: 'navigate', pageId: 'food' } }),
            item('home-chores', 'navigation-tile', 'A fresh start', { subtitle: '2 chores remaining', icon: 'Sparkles', action: { type: 'navigate', pageId: 'chores' } }),
          ] }),
          item('home-laundry', 'progress', 'Laundry is on its way', { subtitle: 'Rinse cycle \u00b7 18 min remaining', icon: 'WashingMachine', binding: { sourceId: 'laundry', path: 'progress' }, props: { value: 0.7 }, layout: { span: 2 } }),
        ]),
        subtitle: 'Maple House',
        toolbar: [
          { id: 'home-profile', label: 'Your profile', icon: 'UserRound', placement: 'leading', action: { type: 'modal', modalId: 'profile' } },
          { id: 'home-house', label: 'House settings', icon: 'SlidersHorizontal', placement: 'trailing', action: { type: 'navigate', pageId: 'settings' } },
        ],
      },
      {
        ...page('food', 'Food', 'CookingPot', [
          item('food-heading', 'heading', 'Good food, less planning', { subtitle: 'Your kitchen, all in one place.', layout: { span: 2 } }),
          item('food-categories-view', 'carousel', 'Suggested categories', { binding: { sourceId: 'food-categories' }, layout: { span: 2 }, props: { itemTitle: 'title', itemSubtitle: 'count' } }),
          item('food-list', 'list', 'Shopping list', { subtitle: 'Keep the household in sync', binding: { sourceId: 'groceries' }, layout: { span: 2 }, props: { itemTitle: 'title', itemSubtitle: 'subtitle', showChecks: true } }),
          item('food-shop', 'action-tile', 'Shopping mode', { icon: 'ShoppingBasket', subtitle: 'A focused list for the store', action: { type: 'toggle', variable: 'groceryMode' } }),
          item('food-planning', 'navigation-tile', 'Tonight is sorted', { subtitle: 'See the meal plan', icon: 'CalendarDays', action: { type: 'modal', modalId: 'meals' } }),
        ]),
        toolbar: [{ id: 'food-add', label: 'Plan dinner', icon: 'Plus', placement: 'trailing', action: { type: 'modal', modalId: 'meals' } }],
      },
      page('chores', 'Chores', 'CircleCheck', [
        item('chores-heading', 'heading', 'Small jobs, shared fairly', { subtitle: 'A home that works for everyone.', layout: { span: 2 } }),
        item('chores-progress', 'progress', 'This week', { subtitle: '7 of 10 complete', props: { value: 0.7 }, layout: { span: 2 } }),
        item('chores-list', 'list', 'Coming up', { binding: { sourceId: 'chores' }, layout: { span: 2 }, props: { itemTitle: 'title', itemSubtitle: 'subtitle', showChecks: true } }),
        item('chores-done', 'toggle', 'Plants watered', { subtitle: 'Mark your first task complete', icon: 'Leaf', props: { variable: 'choreComplete' }, action: { type: 'toggle', variable: 'choreComplete' } }),
      ]),
      page('settings', 'Settings', 'Settings', [
        item('settings-profile', 'profile', 'Sam Taylor', { subtitle: 'Maple House \u00b7 Household member', icon: 'UserRound', binding: { sourceId: 'household' }, props: { initials: 'ST' }, layout: { span: 2 }, action: { type: 'modal', modalId: 'profile' } }),
        item('settings-preferences', 'section', 'Your preferences', { layout: { span: 2 }, children: [
          item('settings-notifications', 'toggle', 'Notifications', { subtitle: 'Only the helpful things', icon: 'Bell', props: { variable: 'notifications' }, action: { type: 'toggle', variable: 'notifications' } }),
          item('settings-cameras', 'toggle', 'Show cameras', { subtitle: 'Camera shortcuts on Home', icon: 'Camera', props: { variable: 'showCameras' }, action: { type: 'toggle', variable: 'showCameras' } }),
          item('settings-guests', 'toggle', 'Guest mode', { subtitle: 'A simpler household experience', icon: 'UsersRound', props: { variable: 'guestMode' }, action: { type: 'toggle', variable: 'guestMode' } }),
        ] }),
        item('settings-support', 'section', 'Support & feedback', { layout: { span: 2 }, children: [
          item('settings-report', 'report-issue', 'Report an issue', { subtitle: 'Tell us what went wrong', icon: 'Bug', action: { type: 'report-issue' } }),
          item('settings-request', 'request-feature', 'Request a feature', { subtitle: 'Help shape your home', icon: 'Lightbulb', action: { type: 'request-feature' } }),
          item('settings-about', 'settings-row', 'About Native Home', { subtitle: 'Designed around your household', icon: 'Info', action: { type: 'modal', modalId: 'about' } }),
        ] }),
      ]),
    ],
    modals: [
      { ...page('profile', 'Your household', 'UserRound', [
        item('profile-card', 'profile', 'Sam Taylor', { subtitle: 'Maple House', props: { initials: 'ST' }, binding: { sourceId: 'household' } }),
        item('profile-note', 'text', 'Everyone belongs here', { props: { text: 'Manage your profile and household preferences from Settings.' } }),
      ]), presentation: 'sheet', detent: 'medium' },
      { ...page('camera', 'Front door', 'Camera', [
        item('camera-feed-main', 'camera-feed', 'Front door', { subtitle: 'Camera preview', props: { placeholder: 'Connect a camera data source to see a live image.' }, layout: { span: 2 } }),
      ]), presentation: 'sheet', detent: 'large' },
      { ...page('meals', 'Tonight at home', 'CookingPot', [
        item('meals-title', 'heading', 'Roasted vegetable bowls', { subtitle: 'A simple weeknight favorite' }),
        item('meals-details', 'text', 'Dinner plan', { props: { text: '30 minutes \u00b7 Serves 2\nUse what is fresh, add your favorite grains, and finish with lemon.' } }),
      ]), presentation: 'sheet', detent: 'medium' },
      { ...page('about', 'Native Home', 'House', [
        item('about-title', 'heading', 'A home that feels like yours'),
        item('about-copy', 'text', 'Studio preview', { props: { text: 'This editable example runs in sample mode. Publishing creates a server-driven configuration snapshot; current iOS integration requires a separate renderer adapter.' } }),
      ]), presentation: 'sheet', detent: 'medium' },
    ],
    liveActivities: [{
      id: 'laundry-activity', name: 'Laundry cycle', enabled: true, attributes: { appliance: 'Washer', room: 'Utility room' },
      variants: {
        lockScreen: [item('laundry-lock', 'progress', 'Laundry', { subtitle: 'Rinse cycle \u00b7 18 min left', icon: 'WashingMachine', props: { value: 0.7 }, binding: { sourceId: 'laundry', path: 'progress' } })],
        compactLeading: [item('laundry-leading', 'status-chip', 'Laundry', { icon: 'WashingMachine', props: { value: 'Rinse' } })],
        compactTrailing: [item('laundry-trailing', 'text', '18 min', { binding: { sourceId: 'laundry', path: 'remaining' } })],
        minimal: [item('laundry-minimal', 'status-chip', 'Laundry', { icon: 'WashingMachine', props: { value: '18m' } })],
        expanded: [item('laundry-expanded', 'progress', 'Fresh clothes soon', { subtitle: 'Rinse cycle \u00b7 Utility room', props: { value: 0.7 }, binding: { sourceId: 'laundry', path: 'progress' } })],
      },
    }],
  };
}
