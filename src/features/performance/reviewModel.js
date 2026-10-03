export const REVIEW_TYPES = ['Self', 'Manager', 'Peer', 'Upward', 'Interdepartmental', '360', 'Project', 'Custom'];
export const SUBJECT_TYPES = ['Employee', 'Department', 'Team', 'Project'];
export const QUESTION_TYPES = ['Rating', 'Text', 'Number', 'Choice'];
const uid = () => crypto.randomUUID();
// Local calendar date; the server enforces the campaign window in IST.
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function newQuestion() {
  return { id: uid(), text: '', type: 'Rating', required: true, weight: 100, options: 'Exceeds expectations\nMeets expectations\nNeeds support' };
}
export function validateTemplate(template) {
  if (!template.title.trim()) throw new Error('Give the template a name.');
  if (!REVIEW_TYPES.includes(template.type)) throw new Error('Choose a review type.');
  if (!template.questions.length) throw new Error('Add at least one question.');
  for (const q of template.questions) {
    if (!q.text.trim() || !QUESTION_TYPES.includes(q.type)) throw new Error('Every question needs text and a supported answer type.');
    if (q.type === 'Choice') {
      const options = q.options.split('\n').map(x => x.trim()).filter(Boolean);
      if (options.length < 2 || new Set(options).size !== options.length) throw new Error('Choice questions need at least two different options, one per line.');
    }
  }
  if (template.scored) {
    const rated = template.questions.filter(q => q.type === 'Rating');
    if (!rated.length || rated.some(q => !Number.isFinite(Number(q.weight)) || Number(q.weight) <= 0) || Math.abs(rated.reduce((s, q) => s + Number(q.weight), 0) - 100) > 0.001) throw new Error('Rating question weights must be positive and total 100%.');
  }
}

export function validateAnswers(template, answers) {
  for (const q of template.questions) {
    const value = answers[q.id];
    const blank = value === undefined || String(value).trim() === '';
    if (q.required && (blank || value === 'N/A')) throw new Error(`Answer the required question: ${q.text}`);
    if (blank || (value === 'N/A' && q.type === 'Rating' && !q.required)) continue;
    if (q.type === 'Rating' && !['1', '2', '3', '4', '5'].includes(String(value))) throw new Error('Ratings must be between 1 and 5.');
    if (q.type === 'Number' && !Number.isFinite(Number(value))) throw new Error('Enter a valid number.');
    if (q.type === 'Choice' && !q.options.split('\n').map(x => x.trim()).includes(value)) throw new Error('Choose one of the listed options.');
  }
}

export function reviewerRole(type, subject, reviewer) {
  if (subject.type !== 'Employee') return type === 'Interdepartmental' ? 'Interdepartmental' : 'Contributor';
  if (reviewer.id === subject.id) return 'Self';
  if (subject.managerId === reviewer.id) return 'Manager';
  if (reviewer.managerId === subject.id) return 'Upward';
  return type === 'Interdepartmental' ? 'Interdepartmental' : 'Peer';
}
