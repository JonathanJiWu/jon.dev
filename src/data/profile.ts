/**
 * Everything the site says about Jonathan, in one place.
 *
 * Source of truth: the résumé. Keep claims here factual and current. To add a role,
 * append to `experience`; to add a project, add a Markdown file in
 * src/content/projects/.
 */

export interface Role {
  title: string;
  org: string;
  /** 'YYYY-MM' */
  start: string;
  /** 'YYYY-MM', or null while current */
  end: string | null;
  location: string;
  partTime?: boolean;
  highlights: string[];
}

export interface Credential {
  credential: string;
  school: string;
  years: string;
  note?: string;
}

export interface SkillGroup {
  group: string;
  items: string[];
}

export const profile = {
  name: 'Jonathan Wu',
  title: 'Software Engineer',
  focus: 'Real-time simulation',
  location: 'Greater Boston',
  email: 'jonathanwubrave@gmail.com',
  links: {
    linkedin: 'https://www.linkedin.com/in/jonathanjiwu',
    github: 'https://github.com/JonathanJiWu',
    writing: 'https://criticalbits.substack.com',
  },
  source: 'https://github.com/JonathanJiWu/jon.dev',
  /** Used for <meta name="description"> and social cards. */
  description:
    'Jonathan Wu is a software engineer focused on real-time simulation: C++ aircraft systems, physics modeling and control systems. MS Computer Science student at Northeastern.',
};

export const intro = {
  lead: 'I build real-time simulations: aircraft systems in C++, physics models, and the closed-loop controls that run them.',
  sub: 'MS in Computer Science at Northeastern · Robotics instructor in Greater Boston',
};

/** Draft bio, written from the résumé. Rewrite it in your own voice. */
export const about: string[] = [
  "I'm a software engineer focused on real-time simulation. At Military Visualizations I architected and implemented the pneumatics simulation for the C-130J and AC-130J in C++, including a closed-loop auto-pressurization algorithm that regulates bleed air, cabin pressure and temperature in real time. I also shipped best-selling add-ons for Microsoft Flight Simulator and Lockheed Martin's Prepar3D.",
  "Today I'm working toward an MS in Computer Science at Northeastern University and teaching programming and robotics to K–12 students around Boston.",
  'The route here wasn’t a straight line: English literature in Shanghai, operations in Beijing, public administration and policy research in Chicago, then repairing and upgrading computers in Boston before a software engineering program at Per Scholas.',
];

export const facts: { label: string; value: string }[] = [
  { label: 'Based in', value: 'Greater Boston' },
  { label: 'Focus', value: 'Real-time simulation, C++, control systems' },
  { label: 'Studying', value: 'MS Computer Science, Northeastern (2026–2028)' },
  { label: 'Shipped', value: 'Add-ons for Microsoft Flight Simulator and Prepar3D' },
  { label: 'Languages', value: 'English, Mandarin (fluent)' },
];

export const skills: SkillGroup[] = [
  {
    group: 'Programming',
    items: ['C++', 'STL', 'Python', 'JavaScript', 'XML', 'DirectX', 'Raylib', 'Bash', 'Linux', 'SQL', 'Visual Studio', 'VS Code'],
  },
  {
    group: 'Engineering',
    items: ['Physics modeling', 'Real-time systems', 'Control systems', 'Numerical methods', 'OOP'],
  },
  {
    group: 'Game & sim',
    items: ['Unreal Engine', 'Unity', 'Microsoft Flight Simulator', 'Prepar3D', 'Blender', 'Godot'],
  },
  {
    group: 'Workflow',
    items: ['Git', 'Agile/Scrum', 'Code review', 'Debugging', 'Technical documentation', 'Jira'],
  },
  {
    group: 'Also',
    items: ['Cross-team communication', 'On-call support', 'Team leadership', 'Fluent Mandarin'],
  },
];

/** In the résumé's order. */
export const experience: Role[] = [
  {
    title: 'Software Engineer',
    org: 'Military Visualizations Inc.',
    start: '2021-11',
    end: '2025-02',
    location: 'Greater Boston / CA',
    highlights: [
      'Architected and implemented a pneumatics simulation system for the C-130J and AC-130J aircraft in C++, featuring a closed-loop auto-pressurization algorithm that dynamically regulates bleed air distribution, cabin pressure and temperature in real time against human inputs, numerical physics and hardware parameters.',
      "Shipped best-selling add-ons for Microsoft Flight Simulator and Lockheed Martin's Prepar3D; maintained zero codebase-breaking incidents across 3+ years and hundreds of build iterations.",
      'Translated complex real-world aeronautical systems (pneumatics, hydraulics, avionics) into accurate, performant simulation logic, balancing physical fidelity with runtime constraints.',
    ],
  },
  {
    title: 'Computer Science & Robotics Instructor',
    org: 'Heath Extended Day Program',
    start: '2026-02',
    end: null,
    location: 'Greater Boston',
    partTime: true,
    highlights: [
      'Design and lead an after-school STEM and coding club for high school students, introducing programming and robotics through hands-on activities with LEGO and K’Nex, and guiding students through coding concepts, game creation and small programming assignments in Scratch, EduBlocks, Python and C++.',
      'Facilitate robotics projects that introduce sensor integration, motor control and basic path-planning using Makeblock robotics kits, while maintaining a hands-on robotics lab.',
    ],
  },
  {
    title: 'Computer Science & Robotics Instructor',
    org: 'Vinci STEAM Education',
    start: '2025-09',
    end: null,
    location: 'Greater Boston',
    partTime: true,
    highlights: [
      'Design and deliver project-based CS and robotics curriculum for K–12 students across skill levels, covering Scratch, EduBlocks, Python and C++.',
      'Coach student robotics teams through rapid prototyping, design documentation and time-constrained builds aligned with agile principles.',
    ],
  },
  {
    title: 'Software Engineer, AI Code Quality Specialist',
    org: 'DataAnnotation',
    start: '2025-07',
    end: '2025-10',
    location: 'Greater Boston / CA',
    partTime: true,
    highlights: [
      'Reviewed AI-generated C++, Python and JavaScript for correctness, performance and best practices; identified edge cases and failure modes to improve model robustness.',
      'Delivered structured technical feedback to AI coding assistant teams, refining prompt behavior and debugging model outputs through iterative review cycles.',
    ],
  },
  {
    title: 'Assistant Team Lead',
    org: 'FY International',
    start: '2021-04',
    end: '2021-11',
    location: 'Greater Boston',
    highlights: [
      "Restructured the PC upgrade team's workflow, redistributing tasks by skill level across technicians, warehouse and repackaging staff, driving a 40% increase in team productivity.",
      "Integrated the department's order management system with the sales platform and digitized the analog tracking system, reducing faulty returns by 20%.",
      'Mentored 5 new team members and led cross-departmental communication to sustain operational continuity during the transition.',
    ],
  },
  {
    title: 'Computer Hardware Technician',
    org: 'FY International',
    start: '2020-07',
    end: '2021-04',
    location: 'Greater Boston',
    highlights: [
      'Performed hardware examinations, repairs and upgrades on laptops, desktops and gaming consoles to customer specifications; installed and optimized operating systems on reconfigured systems.',
    ],
  },
];

/** Before software. Collapsed by default on the page. */
export const earlierExperience: Role[] = [
  {
    title: 'Policy Researcher',
    org: 'Center for Tax and Budget Accountability',
    start: '2016-06',
    end: '2016-12',
    location: 'Chicago',
    highlights: [
      'Researched education, pension and labor policy at the state level; analyzed budgets and demographic data to produce legislative memos and briefings for staff and decision-makers.',
    ],
  },
  {
    title: 'Operations Manager',
    org: 'CapitaLand',
    start: '2014-02',
    end: '2014-11',
    location: 'Beijing',
    highlights: [
      'Managed daily operations of 397,000+ sq ft of commercial real estate with 182 diverse lessees; coordinated across government, contractor and internal stakeholder channels.',
      'Produced 100+ quantitative analyses for the C-suite; streamlined departmental archive and data entry systems to improve operational efficiency.',
    ],
  },
];

export const additional: { title: string; org: string; location: string; year: string }[] = [
  { title: 'Tech Instructor (volunteer)', org: 'Tech Goes Home', location: 'Boston', year: '2021' },
  { title: 'Executive Board Member', org: 'Chinese American Service League', location: 'Chicago', year: '2016' },
  { title: 'Communications Specialist', org: 'Asian Development Service Group NFP', location: 'Chicago', year: '2016' },
  { title: 'Marketing Assistant', org: 'CapitaLand', location: 'Beijing', year: '2013' },
];

export const education: Credential[] = [
  { credential: 'MS, Computer Science', school: 'Northeastern University', years: '2026 – 2028', note: 'In progress' },
  { credential: 'Certificate, Software Engineering', school: 'Per Scholas', years: '2021 – 2022', note: 'GPA 4.0 / 4.0' },
  { credential: 'Master of Public Administration', school: 'Illinois Institute of Technology', years: '2014 – 2015', note: 'GPA 3.81 / 4.0' },
  { credential: 'BA, English Literature', school: 'Shanghai Normal University', years: '2008 – 2012' },
];

/** The robotics / teaching / hardware section: themes drawn from the roles above. */
export const beyond: { title: string; body: string; source: string }[] = [
  {
    title: 'Robotics lab',
    body: 'Makeblock projects that introduce sensor integration, motor control and basic path-planning; hands-on builds with LEGO and K’Nex; coaching student teams through rapid prototyping, design documentation and time-constrained builds.',
    source: 'Heath Extended Day Program · Vinci STEAM Education',
  },
  {
    title: 'Teaching code',
    body: 'Project-based CS curriculum for K–12 students across skill levels in Scratch, EduBlocks, Python and C++, and an after-school coding club for high schoolers that includes game creation.',
    source: 'Since 2025 · volunteer tech instructor with Tech Goes Home, 2021',
  },
  {
    title: 'Hardware',
    body: 'Examined, repaired and upgraded laptops, desktops and game consoles and tuned their operating systems, then restructured the PC upgrade team’s workflow (+40% productivity) and cut faulty returns by 20%.',
    source: 'FY International · 2020 – 2021',
  },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → 'Nov 2021' */
export function formatMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[(m ?? 1) - 1]} ${y}`;
}

export function formatRange(r: Pick<Role, 'start' | 'end'>): string {
  return `${formatMonth(r.start)} – ${r.end ? formatMonth(r.end) : 'Present'}`;
}
