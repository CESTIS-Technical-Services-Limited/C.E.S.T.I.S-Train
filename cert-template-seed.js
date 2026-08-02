/* ============================================================================
   cert-template-seed.js — Certificate template seed for every skill area.

   WHERE THIS DATA COMES FROM
   --------------------------
   Each entry is transcribed from the HEART/NSTA Trust & NCTVET "Packaging of
   Competency Standards for National Vocational Qualifications of Jamaica"
   qualification plan for that programme — specifically its "Clustering of
   Units" tables. So the cluster COUNT and the unit titles under each cluster
   are the real ones a trainee is assessed against, not placeholders.

   HOW IT IS USED
   --------------
   Seeding a skill area fills its certificate template's Page 2 content:
     - clusters  -> the CLUSTERS COMPLETED / MODULES COMPLETED column
     - the units inside each cluster -> TECHNICAL COMPETENCIES ACHIEVED
       (CESTISCore.certTemplate.deriveCompetencies turns each cluster into a
       competency category whose items are its units, which is exactly how the
       Trust describes what the trainee can do when the course finishes)
   The DESIGN (backgrounds, text positions, wording, signatures) is NOT seeded
   here — it is inherited from the base template, so every certificate keeps
   the one corrected look.

   Two plans (the Level 3 ones) predate clustering and list Core/Elective units
   with no clustering table. Their units are grouped here into clusters that
   follow the same thematic pattern the Level 2 plans use, and are flagged with
   clustersDerived:true so the Centre knows to confirm them against the plan.
   ============================================================================ */
(function (root) {
  'use strict';

  /* Each programme:
       course        - certificate course full name
       aliases       - other names the LMS/fee dashboard may use for it
       planCode      - NVQ-J qualification package code
       qualification - the qualification title as printed on the plan
       courseType    - 'Full-time' (clusters) or 'Short Course' (modules)
       coreCredits / totalCredits - from the plan
       clusters      - [{ name, hours, units:[...] }] in plan order
       electives     - optional elective grouping, same shape                */
  var CERT_TEMPLATE_SEED = [
    /* ------------------------------------------------------------------ */
    {
      course: 'Beauty Therapy',
      aliases: ['Beauty Therapy L2', 'General Beauty Therapy'],
      planCode: 'CSB21424',
      qualification: 'NVQ-J Level 2 in General Beauty Therapy',
      courseType: 'Full-time',
      coreCredits: 76, totalCredits: 82,
      industry: 'Community Services', subSector: 'Beauty',
      clusters: [
        { name: 'Perform Facial and Related Treatments in Spa', hours: 480, units: [
          'Design and apply facial make-up',
          'Perform facial treatment',
          'Provide lash and brow treatment',
          'Provide temporary epilation and bleaching treatments',
          'Provide paraffin wax treatment' ] },
        { name: 'Perform Nail Treatments in Spa', hours: 375, units: [
          'Apply nail art',
          'Apply acrylic nail enhancement',
          'Apply gel nail enhancement',
          'Provide manicure and pedicure service' ] },
        { name: 'Acquire and Apply Knowledge of Massage Therapy', hours: 195, units: [
          'Acquire foundation knowledge of massage therapy',
          'Apply knowledge of the history of massage' ] },
        { name: 'Apply Health and Safety Procedures in the Spa', hours: 150, units: [
          'Provide advance first aid',
          'Comply with infection prevention and control policies and procedures',
          'Protect self against communicable diseases in the workplace' ] },
        { name: 'Perform Spa Inventory Management and Financial Transactions', hours: 240, units: [
          'Sell products and services',
          'Conduct financial transactions',
          'Perform stock control procedures' ] },
        { name: 'Apply Advanced Digital Literacy Skills', hours: 210, units: [
          'Perform advanced features of computer applications',
          'Use social media tools for collaboration and engagement' ] },
        { name: 'Apply Effective Communication and Customer Service Skills in Spa', hours: 360, units: [
          'Communicate and interact effectively in the workplace',
          'Apply language and communication skills',
          'Receive and direct clients',
          'Provide quality customer/client service',
          'Schedule and check out clients',
          'Display human relations skills' ] },
        { name: 'Develop Entrepreneurial and Related Skills', hours: 150, units: [
          'Craft personal entrepreneurial strategy',
          'Reflect on and improve own professional practice',
          'Perform mathematical computations' ] }
      ],
      electives: { name: 'Apply Valuable Skills to Spa Services', hours: 180, units: [
        'Perform face shave',
        'Develop and apply conversational skills in a foreign language',
        'Perform hair styling services' ] }
    },

    /* ------------------------------------------------------------------ */
    {
      course: 'Cosmetology',
      aliases: ['Cosmetology L2'],
      planCode: 'CSB21323',
      qualification: 'NVQ-J Level 2 in Cosmetology',
      courseType: 'Full-time',
      coreCredits: 122, totalCredits: 129,
      industry: 'Community Services', subSector: 'Beauty',
      clusters: [
        { name: 'Perform Hair Care Services', hours: 390, units: [
          'Plan and organize work',
          'Prepare clients for salon service',
          'Perform shampooing and conditioning services',
          'Perform head, neck and shoulder massage',
          'Perform wet hair styling and roller placement',
          'Maintain a safe, clean and efficient work environment' ] },
        { name: 'Perform Salon Services', hours: 240, units: [
          'Perform temporary hair colour services',
          'Perform basic hair and scalp treatments',
          'Provide manicure and pedicure services' ] },
        { name: 'Perform Nail Care Services', hours: 345, units: [
          'Apply knowledge of nail science to nail services',
          'Provide manicure and pedicure service',
          'Provide paraffin wax treatment',
          'Apply nail art' ] },
        { name: 'Perform Facial Services', hours: 465, units: [
          'Perform facial treatment',
          'Design and apply facial make-up',
          'Perform face shave',
          'Provide lash and brow treatment',
          'Provide temporary epilation and bleaching treatments' ] },
        { name: 'Perform Chemical Services and Hair Shaping', hours: 495, units: [
          'Consult with clients and diagnose hair and scalp conditions',
          'Utilize sensory skills in beauty services for optimal client experience',
          'Perform chemical straightening services',
          'Perform permanent wave services',
          'Provide permanent hair colour services',
          'Perform semi-permanent hair colour services',
          'Perform hair shaping' ] },
        { name: 'Perform Advanced Salon Services', hours: 330, units: [
          'Maintain wigs and hair pieces',
          'Perform thermal straightening, curling and waving',
          'Perform hair braiding services',
          'Perform hair styling services',
          'Provide advice on retail beauty care products' ] },
        { name: 'Deliver Effective Reception Duties', hours: 405, units: [
          'Apply language and communication skills',
          'Collaborate in a creative process',
          'Contribute to effective workplace relationships',
          'Provide quality customer/client service',
          'Receive and direct clients',
          'Schedule and check out clients',
          'Sell products and services' ] },
        { name: 'Apply Business and Entrepreneurial Skills', hours: 405, units: [
          'Perform mathematical computations',
          'Conduct financial transactions',
          'Undertake research and analysis',
          'Craft personal entrepreneurial strategy',
          'Perform stock control procedures',
          'Comply with regulatory and taxation requirements' ] },
        { name: 'Develop Personal Workplace Skills', hours: 75, units: [
          'Manage time',
          'Exercise professionalism and ethical behaviour' ] },
        { name: 'Apply Advanced Digital Literacy Skills', hours: 120, units: [
          'Use advanced features of computer applications',
          'Use social media tools for collaboration and engagement' ] }
      ],
      electives: { name: 'Apply Design and Language Skills', hours: 195, units: [
        'Perform hair shaping on excessively curly hair',
        'Research interior decoration and design influences',
        'Develop and apply conversational skills in a foreign language' ] }
    },

    /* ------------------------------------------------------------------ */
    {
      course: 'Electrical Installation and Maintenance',
      aliases: ['ELECTRICAL L2', 'Electrical Installation L2', 'Electrical Installation and Maintenance L2', 'Electrical Installation'],
      planCode: 'EEM20723',
      qualification: 'NVQ-J Level 2 in Electrical Installation and Maintenance',
      courseType: 'Full-time',
      coreCredits: 99, totalCredits: 99,
      industry: 'Electro Technology', subSector: 'Electrical Engineering Maintenance',
      clusters: [
        { name: 'Follow Workplace Safety', hours: 135, units: [
          'Follow principles of Occupational Health and Safety (OH&S) in work environment',
          'Apply basic electrical safety' ] },
        { name: 'Perform Workshop Practice', hours: 255, units: [
          'Use and maintain hand and power tools for electrical work',
          'Use and maintain graduated measuring devices',
          'Use marking out tools',
          'Plan to undertake a routine task' ] },
        { name: 'Apply Principles in Electrical Installation', hours: 135, units: [
          'Apply principles and practices in electrical installation',
          'Use electrical/electronic measuring devices' ] },
        { name: 'Prepare for Electrical Work', hours: 120, units: [
          'Draw and interpret sketches and simple drawings',
          'Prepare for electrical conduits/wiring installation' ] },
        { name: 'Carry Out Electrical Installations 1', hours: 345, units: [
          'Interpret and draw standard electrical drawings',
          'Install, terminate and connect electrical wiring systems',
          'Perform manual soldering/de-soldering of electrical/electronic components',
          'Terminate basic signal and data cables',
          'Cut, bend and install electrical conduits' ] },
        { name: 'Carry Out Electrical Installation 2', hours: 420, units: [
          'Cut, fit and install trunking system',
          'Prepare and install basic cable trays',
          'Terminate and connect specialist cables',
          'Plan a complete work activity',
          'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
          'Perform basic testing and inspection on electrical installations' ] },
        { name: 'Troubleshoot and Repair Faulty Electrical & Electronic Circuits', hours: 195, units: [
          'Dismantle and reassemble electromechanical components',
          'Troubleshoot and repair basic electrical/electronic apparatus',
          'Use industrial instrumentation measuring devices' ] },
        { name: 'Install Electrical Circuits', hours: 315, units: [
          'Use electrical software to draw simple circuits',
          'Interpret electrical standard, specifications and manuals',
          'Shut down/isolate machines/equipment',
          'Install electrical and electronic apparatus, machinery, fixtures and secondary wiring',
          'Locate and repair/rectify electrical circuits' ] },
        { name: 'Apply Effective Communication and Reporting Skills within the Workplace', hours: 225, units: [
          'Apply language and communication skills',
          'Write basic technical reports',
          'Provide quality customer service' ] },
        { name: 'Perform Statistical Computations', hours: 90, units: [
          'Perform mathematical computations',
          'Use basic graphical techniques and perform simple statistical computations (Basic)' ] },
        { name: 'Develop Business Skills', hours: 165, units: [
          'Exercise professionalism and ethical behaviour',
          'Craft personal entrepreneurial strategy',
          'Prepare quotations',
          'Order materials' ] },
        { name: 'Use Advanced Digital Literacy Skills', hours: 120, units: [
          'Use advanced features of computer applications',
          'Use social media tools for collaboration and engagement' ] }
      ]
    },

    /* ------------------------------------------------------------------ */
    {
      course: 'Welding',
      aliases: ['Welding L2', 'Welding & Fabrication', 'Welding and Fabrication'],
      planCode: 'MEM22423',
      qualification: 'NVQ-J Level 2 in Welding',
      courseType: 'Full-time',
      coreCredits: 109, totalCredits: 117,
      industry: 'Metal Engineering and Maintenance', subSector: 'Metal Stream',
      clusters: [
        { name: 'Use Workshop Tools Safely', hours: 330, units: [
          'Follow principles of Occupational Health and Safety (OH&S) in work environment',
          'Use and maintain graduated measuring devices',
          'Use hand and power tools',
          'Use workshop machines for basic operations' ] },
        { name: 'Draw and Interpret Simple Drawings', hours: 180, units: [
          'Draw and interpret sketches and simple drawings',
          'Develop basic geometric shapes',
          'Prepare basic engineering drawing' ] },
        { name: 'Weld Using MMAW and OAW Processes', hours: 255, units: [
          'Prepare for oxyacetylene/metal arc welding processes',
          'Perform brazing and/or silver soldering',
          'Perform basic welding using manual metal arc welding process (MMAW)',
          'Perform basic welding using oxyacetylene welding process (OAW) - fuel gas welding' ] },
        { name: 'Perform Basic Fabrication Process', hours: 330, units: [
          'Carry out mechanical cutting operations (basic)',
          'Use marking out tools',
          'Classify engineering materials (basic)',
          'Assemble fabricated components',
          'Perform manual heating, and thermal cutting',
          'Undertake fabrication, forming, bending and shaping' ] },
        { name: 'Create 2-D Drawings Using Computer Aided Software', hours: 120, units: [
          'Prepare basic mechanical drawings',
          'Operate computer aided design (CAD) to produce basic drawing elements' ] },
        { name: 'Perform Advance Weld using MMAW and OAW Processes', hours: 270, units: [
          'Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)',
          'Perform advanced welding using oxyacetylene welding process (OAW)',
          'Mark off/out structural fabrication and shapes',
          'Perform advanced manual thermal cutting, gouging and shaping',
          'Apply quality standards and procedures' ] },
        { name: 'Weld using MIG, TIG and FCAW Processes', hours: 345, units: [
          'Interpret standard specifications and manuals',
          'Weld using gas metal arc welding process (GMAW) - metal inert gas (MIG)',
          'Plan a complete work activity',
          'Perform weld in flat and horizontal positions using flux cored arc welding process (FCAW)',
          'Perform weld in flat and horizontal positions using gas tungsten metal arc welding process (GTAW) - tungsten inert gas (TIG)' ] },
        { name: 'Develop Basic Digital Literacy Skills', hours: 270, units: [
          'Use mobile IT devices',
          'Perform basic computer applications',
          'Participate in online networks and social media' ] },
        { name: 'Apply Effective Communication Skills within the Workplace', hours: 225, units: [
          'Apply language and communication skills',
          'Write basic technical reports',
          'Provide quality customer service' ] },
        { name: 'Develop Business Skills', hours: 225, units: [
          'Exercise professionalism and ethical behaviour',
          'Craft personal entrepreneurial strategy',
          'Prepare quotations',
          'Order materials',
          'Perform mathematical computations' ] },
        { name: 'Develop Personal Workplace Skills', hours: 120, units: [
          'Display human relations skills',
          'Manage personal stress in the workplace',
          'Plan and apply time management strategies' ] }
      ],
      electives: { name: 'Perform Machine Operations', hours: 255, units: [
        'Apply introductory machine programming techniques',
        'Perform levelling and alignment of machines and engineering components',
        'Perform machining operations using horizontal and/or vertical boring machines' ] }
    },

    /* ------------------------------------------------------------------ */
    {
      course: 'Hospitality Villa/Properties Services',
      aliases: ['Hospitality Services L2', 'Hospitality Villa Properties Services', 'Hospitality'],
      planCode: 'THH22522',
      qualification: 'NVQ-J Level 2 in Hospitality Villa/Properties Services',
      courseType: 'Full-time',
      coreCredits: 153, totalCredits: 159,
      industry: 'Tourism and Hospitality', subSector: 'Hospitality',
      clusters: [
        { name: 'Conduct Rooming Procedures', hours: 90, units: [
          'Carry out rooming procedures',
          'Provide bell services',
          'Respond to guest related complaints and requests' ] },
        { name: 'Provide Cleaning Services', hours: 495, units: [
          'Clean public areas',
          'Clean floors, walls, furniture and furnishings',
          'Clean and maintain soft floor and furnishings',
          'Prepare guests rooms',
          'Prepare offices',
          'Provide laundry service',
          'Apply environmentally sustainable work practices' ] },
        { name: 'Provide Food and Beverage Services', hours: 225, units: [
          'Provide food and beverage service',
          'Prepare and serve non-alcoholic beverages',
          'Receive and store stock' ] },
        { name: 'Apply Methods of Cookery to Prepare Food', hours: 480, units: [
          'Prepare dishes using basic methods of cookery',
          'Organize, prepare and present simple dishes',
          'Prepare and cook poultry dishes',
          'Prepare and cook meat and seafood',
          'Prepare stocks, sauces and soups' ] },
        { name: 'Prepare Appetizers and Salads', hours: 390, units: [
          'Use knives for basic task in the kitchen environment',
          'Prepare and present sandwiches',
          'Prepare and present appetizers and salads',
          'Prepare vegetables, fruits, eggs and farinaceous dishes',
          'Clean kitchen premises and equipment' ] },
        { name: 'Develop Industry/Job Knowledge', hours: 150, units: [
          'Develop and update hospitality industry/job knowledge',
          'Apply knowledge of Team Jamaica requirements in the workplace' ] },
        { name: 'Work Effectively within the Hospitality Environment', hours: 135, units: [
          'Operate in a culturally diverse work environment',
          'Work with colleagues and customers',
          'Develop and apply conversational skills in a foreign language',
          'Develop and apply principles of professional codes of conduct & ethics' ] },
        { name: 'Develop Basic Digital Literacy Skills', hours: 270, units: [
          'Perform basic computer applications',
          'Participate in online networks and social media',
          'Use mobile IT devices' ] },
        { name: 'Provide Reception and Reservation Services', hours: 180, units: [
          'Maintain guests’ accounts',
          'Prepare customer accounts and deal with departures',
          'Process cash and non-cash transactions',
          'Receive and process reservations',
          'Provide accommodation reception services' ] },
        { name: 'Provide Guests Services', hours: 120, units: [
          'Facilitate access to external services',
          'Promote and up-sell products and services',
          'Provide customized guests services' ] },
        { name: 'Provide Linen Room Services', hours: 210, units: [
          'Provide linen room services',
          'Repair and recycle linen' ] },
        { name: 'Prepare Savory and Sweet Items', hours: 510, units: [
          'Prepare and produce pastries',
          'Prepare and produce cakes and puddings products',
          'Prepare and produce yeast goods',
          'Prepare and present desserts' ] },
        { name: 'Comply with Hospitality Regulatory Requirements', hours: 75, units: [
          'Comply with the occupational health and safety, security and hygiene practices',
          'Comply with the relevant legislative and regulatory requirements in hospitality' ] },
        { name: 'Identify Entrepreneurial Opportunities', hours: 90, units: [
          'Craft personal entrepreneurial strategy',
          'Develop an understanding of business operations',
          'Use strategies to identify job opportunities' ] },
        { name: 'Develop Life and Career Skills', hours: 150, units: [
          'Apply language and communication skills',
          'Perform mathematical computation',
          'Respond to familiar workplace problems' ] },
        { name: 'Engage in Professional Development', hours: 120, units: [
          'Apply the principles of customer service',
          'Enhance self-management skills for work',
          'Plan and apply time management strategies',
          'Manage personal stress in the workplace' ] }
      ],
      electives: { name: 'Maintain Record System', hours: 120, units: [
        'Maintain housekeeping supplies',
        'Administer the current records systems',
        'Maintain store security and cleanliness' ] }
    },

    /* ------------------------------------------------------------------ *
       LEVEL 3 PLANS — these predate clustering. The published plan lists
       Core and Elective units with no "Clustering of Units" table, so the
       units below are grouped thematically (following the Level 2 pattern)
       and flagged clustersDerived:true for the Centre to confirm.
     * ------------------------------------------------------------------ */
    {
      course: 'Electrical Installation Level 3',
      aliases: ['ELECTRICAL L3', 'Electrical Installation L3', 'Electrical Installation and Maintenance L3'],
      planCode: 'MEM32507',
      qualification: 'NVQ Level III in Electrical Installation',
      courseType: 'Full-time',
      clustersDerived: true,
      industry: 'Metal Engineering and Maintenance', subSector: 'Electrical Engineering',
      clusters: [
        { name: 'Apply Workplace Safety and Work Planning', hours: 65, units: [
          'Follow principles of Occupational Health and Safety (OH&S) in work environment',
          'Plan to undertake a routine task',
          'Plan a complete activity',
          'Plan and organize work' ] },
        { name: 'Use Tools and Measuring Devices', hours: 65, units: [
          'Use hand tools',
          'Use power tools',
          'Use graduated measuring devices',
          'Use electrical/electronic measuring devices',
          'Mark off/out (general engineering)' ] },
        { name: 'Interpret and Produce Engineering Drawings', hours: 45, units: [
          'Draw and interpret sketches and simple drawings',
          'Interpret standard specifications and manuals',
          'Prepare basic engineering drawing' ] },
        { name: 'Carry Out Electrical Installations', hours: 165, units: [
          'Install terminate and connect electrical wiring',
          'Cut bend and install electrical conduits',
          'Prepare for electrical conduits/wiring installation',
          'Cut fit and install trunking system',
          'Prepare and install basic cable trays',
          'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
          'Install electrical/electronic machinery appliances, fixtures' ] },
        { name: 'Terminate and Connect Cables', hours: 50, units: [
          'Terminate signal and data cables (basic)',
          'Terminate and connect specialist cables',
          'Perform manual soldering/de-soldering – electrical/electronic components' ] },
        { name: 'Diagnose, Repair and Maintain Electrical Systems', hours: 240, units: [
          'Perform basic repair to electrical/electronic apparatus',
          'Disconnect and reconnect fixed wired electrical machinery appliance and fixtures',
          'Attach flexible cables & plugs to electrical machinery appliance and fixtures',
          'Shut down/isolate machines/equipment',
          'Fault find and repair/rectify basic electrical circuits and secondary wiring',
          'Check/identify/isolate/rectify malfunctioning electrical machinery appliances and fixtures',
          'Install and maintain electrical equipment',
          'Install and maintain electronic electrical equipment and distribution circuits',
          'Diagnose and repair faults in electrical and electronic systems' ] },
        { name: 'Perform Inspection, Testing and Quality Assurance', hours: 50, units: [
          'Perform inspection (basic)',
          'Perform testing and inspection of electrical installations',
          'Maintain quality systems within a team' ] },
        { name: 'Coordinate Electrical Installation Projects', hours: 100, units: [
          'Coordinate and manage basic installation projects',
          'Plan for wiring and installation of electrical/electronic machinery appliances and fixtures',
          'Coordinate the installation of electrical wiring support system infrastructure',
          'Coordinate the installation of electrical cable and fixture',
          'Coordinate the installation of electrical equipment, ancillary apparatus and secondary wiring' ] },
        { name: 'Apply Communication, Computation and Leadership Skills', hours: 125, units: [
          'Undertake interactive workplace communication',
          'Perform internal and external customer service',
          'Write technical reports (basic)',
          'Perform related computations – basic',
          'Perform related computations',
          'Operate in an autonomous team environment',
          'Support leadership in the workplace' ] },
        { name: 'Perform Materials Handling and Housekeeping', hours: 35, units: [
          'Perform manual handling and lifting',
          'Perform housekeeping duties',
          'Purchase materials' ] }
      ],
      electives: { name: 'Apply Specialist Electrical Skills', hours: 0, units: [
        'Prepare basic engineering drawing',
        'Classify engineering materials (basic)',
        'Carry out data entry and retrieval procedures',
        'Assemble & disassemble scaffolding to enable access to the work area',
        'Craft personal entrepreneurial strategy',
        'Order materials',
        'Install below ground communication cables',
        'Use industrial instrumentation measuring devices',
        'Attend to breakdown in hazardous area',
        'Assist in the provision of on the job training',
        'Coordinate the installation of substation plant and apparatus',
        'Diagnose & repair faults in electrical equipment',
        'Support operational plan',
        'Support continuous improvement systems and processes',
        'Coordinate and manage commissioning processes',
        'Determine and plan for electrical installation requirements',
        'Interpret and carry out electrical design',
        'Evaluate electrical installation',
        'Perform testing on complex electrical installation' ] }
    },

    /* ------------------------------------------------------------------ */
    {
      course: 'Welding Level 3',
      aliases: ['Welding L3'],
      planCode: 'MEM30215',
      qualification: 'NVQ Level III in Welding',
      courseType: 'Full-time',
      clustersDerived: true,
      industry: 'Metal Engineering and Maintenance', subSector: 'Metal Stream',
      clusters: [
        { name: 'Apply Workplace Safety and Work Planning', hours: 55, units: [
          'Follow principles of Occupational Health and Safety (OH&S) in work environment',
          'Plan to undertake a routine task',
          'Plan a complete activity' ] },
        { name: 'Use Workshop Tools and Measuring Devices', hours: 45, units: [
          'Use hand tools',
          'Use and care power tools',
          'Use and maintain graduated measuring devices',
          'Mark off/out (general engineering)' ] },
        { name: 'Interpret Drawings and Engineering Materials', hours: 85, units: [
          'Draw and interpret sketch and simple drawing',
          'Classify engineering materials (basic)',
          'Interpret standard specifications and manuals',
          'Develop geometric shapes (basic)' ] },
        { name: 'Perform Cutting, Forming and Fabrication', hours: 130, units: [
          'Carry out mechanical cutting operations (basic)',
          'Perform manual heating and thermal cutting',
          'Undertake fabrication, forming, bending and shaping (basic)',
          'Assemble fabricated components (basic)',
          'Perform advanced manual thermal cutting, gouging and shaping' ] },
        { name: 'Weld Using MMAW and OAW Processes', hours: 160, units: [
          'Prepare for oxyacetylene/metal arc welding processes',
          'Perform brazing and/or silver soldering',
          'Perform basic welding using manual metal arc welding process (MMAW)',
          'Perform basic welding using oxyacetylene welding process (OAW) - fuel gas welding',
          'Perform advanced welding using manual metal arc welding process (MMAW)' ] },
        { name: 'Weld Using MIG and Advanced Processes', hours: 40, units: [
          'Weld using gas metal arc welding process GMAW - metal inert gas (MIG)' ] },
        { name: 'Apply Communication, Computation and Digital Skills', hours: 90, units: [
          'Undertake interactive workplace communication',
          'Carry out data entry and retrieval procedures',
          'Perform related computations (basic)',
          'Perform related computations',
          'Write technical reports (basic)' ] },
        { name: 'Perform Materials Handling and Teamwork', hours: 20, units: [
          'Perform manual handling and lifting',
          'Perform housekeeping duties',
          'Operate in an autonomous team environment' ] }
      ]
    }
  ];

  /* ==========================================================================
     PURE HELPERS (unit tested)
     ========================================================================== */

  function norm(s) { return String(s == null ? '' : s).toLowerCase().trim().replace(/\s+/g, ' '); }

  /* Find the seed entry for a course/skill-area name, matching the course name
     or any of its aliases (case/space-insensitive). */
  function findSeed(courseName) {
    var cn = norm(courseName);
    if (!cn) return null;
    for (var i = 0; i < CERT_TEMPLATE_SEED.length; i++) {
      var s = CERT_TEMPLATE_SEED[i];
      if (norm(s.course) === cn) return s;
      for (var j = 0; j < (s.aliases || []).length; j++) {
        if (norm(s.aliases[j]) === cn) return s;
      }
    }
    return null;
  }

  /* The clusters a trainee completes, as certificate "modules" entries.
     Each cluster's units become its topics, which the certificate renderer
     turns into the Technical Competencies Achieved for that cluster. */
  function seedClusters(seed, includeElectives) {
    if (!seed) return [];
    var out = (seed.clusters || []).map(function (c) {
      return { name: c.name, contactHours: c.hours || 0, topics: (c.units || []).slice() };
    });
    if (includeElectives && seed.electives) {
      out.push({ name: seed.electives.name + ' (Electives)',
        contactHours: seed.electives.hours || 0, topics: (seed.electives.units || []).slice() });
    }
    return out;
  }

  /* Total taught hours across the clusters — used for the certificate's
     Programme Specifications "Duration". */
  function seedDuration(seed, includeElectives) {
    var cl = seedClusters(seed, includeElectives);
    var total = cl.reduce(function (a, c) { return a + (c.contactHours || 0); }, 0);
    return total ? (total + ' Contact Hours') : '';
  }

  /* Build the course-content half of a certificate template. The DESIGN is
     never touched here — it comes from the base template. */
  function templateContentFor(courseName, opts) {
    opts = opts || {};
    var seed = findSeed(courseName);
    if (!seed) return null;
    var clusters = seedClusters(seed, opts.includeElectives !== false);
    return {
      courseFullName: seed.course,
      courseType: seed.courseType || 'Full-time',
      programmeCode: seed.planCode || '',
      modules: clusters,
      // Left empty on purpose: the renderer derives Technical Competencies
      // Achieved from the clusters above, so they always match what was taught.
      competencies: [],
      programmeSpecs: {
        duration: seedDuration(seed, opts.includeElectives !== false),
        industry: seed.industry || '',
        subSector: seed.subSector || '',
        entryRequirements: opts.entryRequirements || '',
        assessment: opts.assessment || 'Written and Practical Assessment',
        alignment: opts.alignment || 'Jamaica Vision 2030'
      },
      qualification: seed.qualification || '',
      clusterCount: (seed.clusters || []).length,
      clustersDerived: !!seed.clustersDerived,
      totalCredits: seed.totalCredits || null,
      coreCredits: seed.coreCredits || null
    };
  }

  /* A one-line summary per programme, for the seeding UI. */
  function seedSummary() {
    return CERT_TEMPLATE_SEED.map(function (s) {
      return {
        course: s.course,
        planCode: s.planCode,
        qualification: s.qualification,
        clusters: (s.clusters || []).length,
        units: (s.clusters || []).reduce(function (a, c) { return a + (c.units || []).length; }, 0),
        electives: s.electives ? (s.electives.units || []).length : 0,
        totalCredits: s.totalCredits || null,
        derived: !!s.clustersDerived
      };
    });
  }

  var api = {
    CERT_TEMPLATE_SEED: CERT_TEMPLATE_SEED,
    findSeed: findSeed,
    seedClusters: seedClusters,
    seedDuration: seedDuration,
    templateContentFor: templateContentFor,
    seedSummary: seedSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CESTISCertSeed = api;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
