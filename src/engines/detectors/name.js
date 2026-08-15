/**
 * ARKN Detector — Person Names
 *
 * 7 detection passes with varying confidence levels:
 *   1. Honorifics (Dr James)           → 0.95
 *   2. Greetings (Hi Bunmi)            → 0.90
 *   3. Introductions (my name is Priya) → 0.92
 *   4. Sign-offs (Regards, Khalid)      → 0.90
 *   5. Dictionary (300+ global names)   → 0.85
 *   6. Social context (my friend Bunmi) → 0.80
 *   7. Verb context (tell James)        → 0.78
 *
 * Returns position-aware Candidate objects. Does NOT replace text.
 */
(function (global) {
  'use strict';
  const create = global.__ARKN_PIPELINE__.createCandidate;

  // ── 300+ Global Name Dictionary ──────────────────────────────────────────
  const COMMON_NAMES = new Set([
    // Anglo-American (male)
    'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
    'Christopher', 'Daniel', 'Matthew', 'Anthony', 'Mark', 'Donald', 'Steven', 'Paul', 'Andrew', 'Joshua',
    'Kenneth', 'Kevin', 'Brian', 'George', 'Edward', 'Ronald', 'Timothy', 'Jason', 'Jeffrey', 'Ryan',
    'Jacob', 'Gary', 'Nicholas', 'Eric', 'Jonathan', 'Stephen', 'Larry', 'Justin', 'Scott', 'Brandon',
    'Benjamin', 'Samuel', 'Gregory', 'Frank', 'Alexander', 'Raymond', 'Patrick', 'Jack', 'Dennis', 'Jerry',
    'Tyler', 'Aaron', 'Jose', 'Adam', 'Nathan', 'Henry', 'Douglas', 'Zachary', 'Peter', 'Kyle',
    // Anglo-American (female)
    'Mary', 'Patricia', 'Jennifer', 'Linda', 'Elizabeth', 'Barbara', 'Susan', 'Jessica', 'Sarah', 'Karen',
    'Lisa', 'Nancy', 'Betty', 'Sandra', 'Margaret', 'Ashley', 'Kimberly', 'Emily', 'Donna', 'Michelle',
    'Carol', 'Amanda', 'Dorothy', 'Melissa', 'Deborah', 'Stephanie', 'Rebecca', 'Sharon', 'Laura', 'Cynthia',
    'Kathleen', 'Amy', 'Shirley', 'Angela', 'Helen', 'Anna', 'Brenda', 'Pamela', 'Nicole', 'Samantha',
    'Katherine', 'Emma', 'Ruth', 'Christine', 'Catherine', 'Debra', 'Rachel', 'Carolyn', 'Janet', 'Virginia',
    'Maria', 'Heather', 'Diane', 'Julie', 'Joyce', 'Victoria', 'Kelly', 'Christina', 'Lauren', 'Joan',
    'Evelyn', 'Olivia', 'Judith', 'Megan', 'Cheryl', 'Martha', 'Andrea', 'Frances', 'Hannah', 'Jacqueline',
    'Jane', 'Alice', 'Bob', 'Claire', 'Sophie', 'Charlotte', 'Grace', 'Lucy', 'Ella', 'Lily', 'Kay',
    'Harry', 'Oliver', 'George', 'Charlie', 'Noah', 'Liam', 'Leo', 'Ethan', 'Isaac', 'Oscar',
    // Yoruba / West African
    'Bunmi', 'Tunde', 'Funmi', 'Bola', 'Sade', 'Wole', 'Femi', 'Seun', 'Kemi', 'Temi',
    'Lola', 'Dele', 'Bisi', 'Dupe', 'Nike', 'Tobi', 'Dayo', 'Goke', 'Lanre', 'Deji',
    'Yemi', 'Titi', 'Remi', 'Ayo', 'Biodun', 'Bimbo', 'Kunle', 'Sola', 'Wale', 'Rotimi',
    'Gbenga', 'Seyi', 'Jide', 'Bayo', 'Akin', 'Dapo', 'Leke', 'Ade', 'Tokunbo', 'Oluseun',
    // Igbo / South-Eastern Nigerian
    'Emeka', 'Ngozi', 'Chidi', 'Chinwe', 'Amara', 'Nnamdi', 'Obioma', 'Adaeze', 'Chukwuemeka',
    'Uche', 'Ify', 'Ifeoma', 'Chinyere', 'Kelechi', 'Obinna', 'Chisom', 'Chidinma',
    // Hausa / Northern Nigerian
    'Musa', 'Usman', 'Ibrahim', 'Halima', 'Amina', 'Abubakar', 'Sadiya', 'Hauwa',
    // Ghanaian / Other West African
    'Kwame', 'Ama', 'Kofi', 'Akosua', 'Kwesi', 'Abena', 'Yaw', 'Adjoa', 'Kojo',
    'Esi', 'Nana', 'Fiifi', 'Efua', 'Dela', 'Eyram', 'Mawuli', 'Kafui',
    // South Asian (Indian Subcontinent)
    'Priya', 'Arun', 'Kavya', 'Deepa', 'Ravi', 'Meera', 'Anil', 'Sunita', 'Vijay', 'Anita',
    'Raj', 'Pooja', 'Amit', 'Sanjay', 'Nisha', 'Suresh', 'Divya', 'Kiran', 'Rahul', 'Sneha',
    'Arjun', 'Neha', 'Vikram', 'Asha', 'Rohan', 'Anjali', 'Sunil', 'Rekha', 'Ajay', 'Madhuri',
    'Nikhil', 'Swati', 'Gaurav', 'Preeti', 'Varun', 'Shweta', 'Manish', 'Geeta', 'Akash', 'Ritu',
    'Harpreet', 'Gurpreet', 'Navdeep', 'Jaspreet', 'Simran', 'Kaur', 'Patel', 'Singh',
    'Aditi', 'Zara', 'Leena', 'Sapna', 'Reena', 'Seema', 'Meena', 'Veena',
    // Arabic / Middle Eastern
    'Mohammed', 'Ahmad', 'Ali', 'Omar', 'Hassan', 'Yusuf', 'Aisha', 'Fatima', 'Zainab',
    'Maryam', 'Layla', 'Nadia', 'Rania', 'Tariq', 'Khalid', 'Hamid', 'Nasser', 'Samir',
    'Yasmin', 'Leila', 'Dina', 'Hana', 'Lina', 'Reem', 'Noura', 'Mariam', 'Hind',
    'Karim', 'Bilal', 'Walid', 'Khaled', 'Salim', 'Faisal', 'Rashid', 'Majid',
    // Eastern European
    'Olga', 'Natasha', 'Dmitri', 'Ivan', 'Katya', 'Mikhail', 'Anastasia', 'Pavel',
    'Sasha', 'Irina', 'Sergei', 'Elena', 'Tatiana', 'Andrei', 'Yulia', 'Alexei',
    'Viktor', 'Ludmila', 'Nikolai', 'Vera', 'Boris', 'Oksana', 'Vitaly', 'Daria',
    'Piotr', 'Agnieszka', 'Tomasz', 'Krzysztof', 'Mateusz', 'Zofia', 'Magdalena',
    // East / South-East Asian
    'Wei', 'Mei', 'Hong', 'Jing', 'Hui', 'Xiao', 'Ming', 'Fang', 'Lin', 'Ying',
    'Tao', 'Jun', 'Shan', 'Yan', 'Hao', 'Ting', 'Peng', 'Xin', 'Zhen', 'Rui',
    'Tanaka', 'Kenji', 'Yuki', 'Sakura', 'Hiroshi', 'Aiko', 'Takeshi', 'Yuko',
    'Kim', 'Ji', 'Min', 'Soo', 'Young', 'Jae', 'Hyun', 'Sun', 'Sung', 'Hee',
    // Latin American / Spanish
    'Carlos', 'Miguel', 'Juan', 'Luis', 'Antonio', 'Francisco', 'Jorge', 'Diego',
    'Sofia', 'Isabella', 'Valentina', 'Camila', 'Lucia', 'Gabriela', 'Daniela', 'Mariana',
    'Pedro', 'Alejandro', 'Pablo', 'Andres', 'Ricardo', 'Fernando', 'Eduardo', 'Rodrigo',
  ]);

  // ── Stopwords ──────────────────────────────────────────────────────────────
  const STOPWORDS = new Set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren\'t', 'as', 'at',
    'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'can', 'can\'t', 'cannot',
    'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does', 'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each',
    'few', 'for', 'from', 'further', 'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d',
    'he\'ll', 'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s', 'i',
    'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its', 'itself', 'let\'s',
    'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'name', 'names', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
    'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'shan\'t', 'she',
    'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t', 'so', 'some', 'such', 'than', 'that', 'that\'s', 'the',
    'their', 'theirs', 'them', 'themselves', 'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll',
    'they\'re', 'they\'ve', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t',
    'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when', 'when\'s', 'where',
    'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s', 'with', 'won\'t', 'would', 'wouldn\'t',
    'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve', 'your', 'yours', 'yourself', 'yourselves',
    'friend', 'colleague', 'associate', 'client', 'partner', 'contact', 'employee', 'manager', 'boss', 'coworker',
    'peer', 'classmate', 'teammate', 'person', 'people', 'man', 'woman', 'boy', 'girl', 'guy', 'sir', 'madam'
  ]);

  function isValid(word) {
    if (!word || word.length < 2) return false;
    const parts = word.split(/\s+/);
    return parts.every((p) => p.length >= 2 && !STOPWORDS.has(p.toLowerCase()));
  }

  // ── Helper: find all non-overlapping match positions for a regex ─────────
  function findAll(regex, text, type, confidence, detector) {
    regex.lastIndex = 0;
    const results = [];
    let m;
    while ((m = regex.exec(text)) !== null) {
      const captured = m[1]; // capture group 1 = the name
      if (!captured || !isValid(captured)) continue;

      // Find the position of the captured group within the full match
      const capturedStart = m.index + m[0].indexOf(captured);
      results.push(create(capturedStart, capturedStart + captured.length, captured, type, confidence, detector));
    }
    return results;
  }

  function detect(text) {
    const candidates = [];

    // 1. Honorifics: Mr/Ms/Mrs/Dr/Prof/Sir/Lady/Mx [Name] [Name]
    candidates.push(...findAll(
      /\b(?:Mr|Ms|Mrs|Dr|Prof|Sir|Lady|Mx)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g,
      text, 'NAME', 0.95, 'context-honorific'
    ));

    // 2. Greetings: Dear/Hi/Hello/Hey/To [Name]
    candidates.push(...findAll(
      /\b(?:Dear|Hi|Hello|Hey|To|Greetings),?\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\b/g,
      text, 'NAME', 0.90, 'context-greeting'
    ));

    // 3. Introductions: my name is [Name], call me [Name]
    const introRe = /\b(?:my name is|names? is|call me|i'm|i am|speaking with|contact),?\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\b/gi;
    introRe.lastIndex = 0;
    let m;
    while ((m = introRe.exec(text)) !== null) {
      const captured = m[1];
      if (isValid(captured)) {
        const capturedStart = m.index + m[0].indexOf(captured);
        candidates.push(create(capturedStart, capturedStart + captured.length, captured, 'NAME', 0.92, 'context-intro'));
      }
    }

    // 4. Contact or address reference: "address location etc of femi balogun"
    candidates.push(...findAll(
      /\b(?:address|location|details?|contact|information|number|email)(?:\s+(?:address|location|details?|contact|information|number|email|etc\.?)){0,4}\s+of\s+([A-Za-z][a-z]+\s+[A-Za-z][a-z]+)\b/gi,
      text, 'NAME', 0.90, 'context-person-reference'
    ));

    // 5. Sign-offs: Sincerely, [Name]
    candidates.push(...findAll(
      /\b(?:Regards|Sincerely|Thanks|Best|Best regards|Yours sincerely|Kind regards|Cheers|From),?\s+([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?)\b/g,
      text, 'NAME', 0.90, 'context-signoff'
    ));

    // 5. Dictionary-based: capitalized words that appear in COMMON_NAMES
    const capRe = /\b([A-Z][a-z]+)\b/g;
    capRe.lastIndex = 0;
    while ((m = capRe.exec(text)) !== null) {
      if (COMMON_NAMES.has(m[1]) && isValid(m[1])) {
        candidates.push(create(m.index, m.index + m[1].length, m[1], 'NAME', 0.85, 'dict-name'));
      }
    }

    // 6. Social context: "my friend Bunmi", "this colleague James"
    const socialRe = /\b(?:my|our|a|this|the)\s+(?:friend|colleague|associate|client|partner|contact|employee|manager|boss|coworker|co-worker|peer|classmate|teammate)\s+([A-Za-z]{2,20})\b/gi;
    socialRe.lastIndex = 0;
    while ((m = socialRe.exec(text)) !== null) {
      const raw = m[1];
      if (isValid(raw)) {
        const normalized = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
        const capturedStart = m.index + m[0].indexOf(raw);
        candidates.push(create(capturedStart, capturedStart + raw.length, normalized, 'NAME', 0.80, 'context-social'));
      }
    }

    // 7. Verb context: "tell James", "ask Bunmi", "contact Sarah"
    const verbRe = /\b(?:tell|ask|call|email|message|contact|meet|inform|update|speak\s+to|speak\s+with|talk\s+to|chat\s+with|cc|invite)\s+([A-Z][a-z]{1,20})\b/g;
    verbRe.lastIndex = 0;
    while ((m = verbRe.exec(text)) !== null) {
      if (isValid(m[1])) {
        const capturedStart = m.index + m[0].indexOf(m[1]);
        candidates.push(create(capturedStart, capturedStart + m[1].length, m[1], 'NAME', 0.78, 'context-verb'));
      }
    }

    return candidates;
  }

  // Expose dictionary and stopwords for scorer boosting
  global.__ARKN_PIPELINE__.COMMON_NAMES = COMMON_NAMES;
  global.__ARKN_PIPELINE__.STOPWORDS = STOPWORDS;

  global.__ARKN_DETECTORS__.push({ id: 'name-detector', detect });
})(typeof window !== 'undefined' ? window : globalThis);
