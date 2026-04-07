import { Brand, Category, InstructionSet, GuidePublication, InstructionStep, SupportQuestion, Feedback, Profile, GuideWithMeta } from '@/types/guide';

export const brands: Brand[] = [
  {
    id: 'b1',
    key: 'trailbait',
    name: 'Trailbait',
    domain: 'guide.trailbait.com.au',
    logo_url: '',
    primary_colour: '#E97316',
    support_phone: '1300 TRAIL',
    support_email: 'support@trailbait.com.au',
    dymo_label_size: '30330',
  },
  {
    id: 'b2',
    key: 'aga',
    name: 'Automotive Group Australia',
    domain: 'guide.automotivegroup.com.au',
    logo_url: '',
    primary_colour: '#F59E0B',
    support_phone: '1300 AGA',
    support_email: 'support@automotivegroup.com.au',
    dymo_label_size: '30330',
  },
];

export const categories: Category[] = [
  { id: 'c1', name: 'Bull Bars', slug: 'bull-bars', guide_count: 3 },
  { id: 'c2', name: 'Roof Racks', slug: 'roof-racks', guide_count: 2 },
  { id: 'c3', name: 'Side Steps', slug: 'side-steps', guide_count: 1 },
  { id: 'c4', name: 'Tow Bars', slug: 'tow-bars', guide_count: 0 },
];

export const instructionSets: InstructionSet[] = [
  {
    id: 'g1',
    title: 'Heavy Duty Bull Bar — Toyota Hilux 2021+',
    product_code: 'BB-TH21',
    short_description: 'Complete installation guide for the heavy-duty steel bull bar designed for the Toyota Hilux 2021 and later models.',
    product_image_url: '',
    tools_required: ['10mm socket', '13mm socket', '17mm spanner', 'Torque wrench', 'Drill with 10mm bit', 'Jack stands'],
    category_id: 'c1',
    estimated_time: '2–3 hours',
    slug: 'heavy-duty-bull-bar-hilux-2021',
    created_at: '2025-01-15T08:00:00Z',
    updated_at: '2025-03-20T14:30:00Z',
  },
  {
    id: 'g2',
    title: 'Adventure Roof Rack — Ford Ranger 2023+',
    product_code: 'RR-FR23',
    short_description: 'Step-by-step fitting instructions for the adventure series aluminium roof rack on Ford Ranger.',
    product_image_url: '',
    tools_required: ['Hex key set', 'Phillips screwdriver', 'Torque wrench', 'Tape measure'],
    category_id: 'c2',
    estimated_time: '1–1.5 hours',
    slug: 'adventure-roof-rack-ranger-2023',
    created_at: '2025-02-01T10:00:00Z',
    updated_at: '2025-03-18T09:00:00Z',
  },
  {
    id: 'g3',
    title: 'Rock Slider Side Steps — Isuzu D-Max 2022+',
    product_code: 'SS-DM22',
    short_description: 'Installation guide for rock slider side steps with integrated jack points.',
    product_image_url: '',
    tools_required: ['19mm socket', '17mm socket', 'Torque wrench', 'Jack stands', 'Thread locker'],
    category_id: 'c3',
    estimated_time: '1.5–2 hours',
    slug: 'rock-slider-side-steps-dmax-2022',
    created_at: '2025-02-10T11:00:00Z',
    updated_at: '2025-03-15T16:00:00Z',
  },
  {
    id: 'g4',
    title: 'Nudge Bar — Mazda BT-50 2021+',
    product_code: 'NB-BT21',
    short_description: 'Quick-fit nudge bar installation for Mazda BT-50 with airbag-compatible mounting.',
    product_image_url: '',
    tools_required: ['10mm socket', '13mm socket', 'Torque wrench'],
    category_id: 'c1',
    estimated_time: '45 mins',
    slug: 'nudge-bar-bt50-2021',
    created_at: '2025-03-01T08:00:00Z',
    updated_at: '2025-03-22T10:00:00Z',
  },
  {
    id: 'g5',
    title: 'Platform Roof Rack — Toyota LandCruiser 300',
    product_code: 'RR-LC300',
    short_description: 'Full-length platform rack installation for the LandCruiser 300 series.',
    product_image_url: '',
    tools_required: ['Hex key set', 'Torque wrench', 'Tape measure', 'Spirit level'],
    category_id: 'c2',
    estimated_time: '2 hours',
    slug: 'platform-roof-rack-lc300',
    created_at: '2025-03-05T09:00:00Z',
    updated_at: '2025-03-05T09:00:00Z',
  },
];

export const publications: GuidePublication[] = [
  { id: 'p1', instruction_set_id: 'g1', brand_id: 'b1', status: 'published', published_at: '2025-01-20T10:00:00Z' },
  { id: 'p2', instruction_set_id: 'g1', brand_id: 'b2', status: 'published', published_at: '2025-01-20T10:00:00Z' },
  { id: 'p3', instruction_set_id: 'g2', brand_id: 'b1', status: 'published', published_at: '2025-02-05T12:00:00Z' },
  { id: 'p4', instruction_set_id: 'g2', brand_id: 'b2', status: 'draft' },
  { id: 'p5', instruction_set_id: 'g3', brand_id: 'b1', status: 'published', published_at: '2025-02-15T08:00:00Z' },
  { id: 'p6', instruction_set_id: 'g4', brand_id: 'b2', status: 'published', published_at: '2025-03-05T09:00:00Z' },
];

export const steps: InstructionStep[] = [
  { id: 's1', instruction_set_id: 'g1', step_number: 1, subtitle: 'Remove factory bumper', description: 'Disconnect any electrical connectors behind the bumper (fog lights, sensors). Remove the 6x 10mm bolts from the bumper support brackets — 3 per side. Carefully pull the bumper forward and off the vehicle. Set aside all bolts and clips for reinstallation if needed.', order_index: 1 },
  { id: 's2', instruction_set_id: 'g1', step_number: 2, subtitle: 'Prepare mounting brackets', description: 'Locate the chassis mounting points on each side. Clean any surface rust or debris from the chassis rail. Loosely fit the supplied mounting brackets using the M12 bolts — do not fully tighten yet. Ensure the brackets are level using a spirit level.', order_index: 2 },
  { id: 's3', instruction_set_id: 'g1', step_number: 3, subtitle: 'Fit bull bar to brackets', description: 'With a helper, lift the bull bar into position on the mounting brackets. Insert the top bolts first to secure the bar, then the lower bolts. Hand-tighten all bolts before final torquing.', order_index: 3 },
  { id: 's4', instruction_set_id: 'g1', step_number: 4, subtitle: 'Torque all bolts', description: 'Using a torque wrench, tighten all mounting bolts to 85Nm. Start from the centre and work outwards. Double-check each bolt after the first pass.', order_index: 4 },
  { id: 's5', instruction_set_id: 'g1', step_number: 5, subtitle: 'Reconnect wiring', description: 'Reconnect fog light wiring using the supplied harness adapter. Route cables along existing wire looms and secure with cable ties. Test all lights before final assembly.', order_index: 5 },
  { id: 's6', instruction_set_id: 'g1', step_number: 6, subtitle: 'Final inspection', description: 'Check all bolts are torqued correctly. Verify the bar is centred and level. Test indicator and fog light operation. Check for any rubbing or fouling when steering at full lock.', order_index: 6 },
];

export const supportQuestions: SupportQuestion[] = [
  { id: 'sq1', instruction_set_id: 'g1', brand_id: 'b1', step_number: 3, session_id: 'sess-001', question: "The bull bar doesn't align with the left bracket. There's about a 5mm gap.", answer: "This is common if the chassis bracket isn't fully seated. Try loosening the bracket bolts, tapping the bracket flush against the chassis rail with a rubber mallet, then retighten. The gap should close.", escalated: false, resolved: true, created_at: '2025-03-18T14:30:00Z' },
  { id: 'sq2', instruction_set_id: 'g2', brand_id: 'b1', step_number: 2, session_id: 'sess-002', question: "Which hex key size do I need for the cross bars?", answer: "You'll need a 5mm hex key for the cross bar clamps.", escalated: false, resolved: true, created_at: '2025-03-19T09:15:00Z' },
  { id: 'sq3', instruction_set_id: 'g1', brand_id: 'b2', step_number: 5, session_id: 'sess-003', question: "My fog lights aren't working after reconnecting. The harness adapter doesn't seem to match.", escalated: true, resolved: false, created_at: '2025-03-22T11:00:00Z' },
  { id: 'sq4', instruction_set_id: 'g3', brand_id: 'b1', step_number: 1, session_id: 'sess-004', question: "Can I install these without jack stands?", answer: "We strongly recommend using jack stands for safety. The vehicle must be properly supported when working underneath.", escalated: false, resolved: true, created_at: '2025-03-23T08:45:00Z' },
];

export const feedbackItems: Feedback[] = [
  { id: 'f1', instruction_set_id: 'g1', brand_id: 'b1', rating: 5, comment: 'Great instructions, very clear photos.', type: 'rating', resolved: false, created_at: '2025-03-19T16:00:00Z', session_id: 'sess-010' },
  { id: 'f2', instruction_set_id: 'g1', brand_id: 'b2', rating: 4, type: 'rating', resolved: false, created_at: '2025-03-20T10:00:00Z', session_id: 'sess-011' },
  { id: 'f3', instruction_set_id: 'g2', brand_id: 'b1', rating: 3, comment: 'Step 3 photo is blurry, hard to see bolt locations.', flagged_step: 3, type: 'flag', resolved: false, created_at: '2025-03-21T08:00:00Z', session_id: 'sess-012' },
  { id: 'f4', instruction_set_id: 'g1', brand_id: 'b1', rating: 5, type: 'rating', resolved: false, created_at: '2025-03-22T14:00:00Z', session_id: 'sess-013' },
  { id: 'f5', instruction_set_id: 'g3', brand_id: 'b1', comment: 'Missing info about which side to start with.', flagged_step: 1, type: 'flag', resolved: false, created_at: '2025-03-23T11:30:00Z', session_id: 'sess-014' },
];

export const profiles: Profile[] = [
  { id: 'u1', full_name: 'James Mitchell', email: 'james@aga.com.au', role: 'admin', last_active: '2025-03-25T16:00:00Z' },
  { id: 'u2', full_name: 'Sarah Chen', email: 'sarah@aga.com.au', role: 'editor', last_active: '2025-03-24T12:00:00Z' },
  { id: 'u3', full_name: 'Tom Baker', email: 'tom@aga.com.au', role: 'editor', last_active: '2025-03-20T09:00:00Z' },
];

export function getGuidesWithMeta(): GuideWithMeta[] {
  return instructionSets.map(guide => ({
    ...guide,
    category_name: categories.find(c => c.id === guide.category_id)?.name,
    publications: publications.filter(p => p.instruction_set_id === guide.id),
    steps: steps.filter(s => s.instruction_set_id === guide.id),
    avg_rating: guide.id === 'g1' ? 4.7 : guide.id === 'g2' ? 3.0 : guide.id === 'g3' ? 4.2 : undefined,
    views_30d: guide.id === 'g1' ? 342 : guide.id === 'g2' ? 189 : guide.id === 'g3' ? 97 : guide.id === 'g4' ? 54 : 0,
  }));
}
