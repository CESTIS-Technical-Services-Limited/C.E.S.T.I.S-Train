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
     - clusters      -> the CLUSTERS COMPLETED / MODULES COMPLETED column
     - competencies  -> the TECHNICAL COMPETENCIES ACHIEVED column
   The DESIGN (backgrounds, text positions, wording, signatures) is NOT seeded
   here — it is inherited from the base template, so every certificate keeps
   the one corrected look.

   THE TWO COLUMNS SAY DIFFERENT THINGS
   ------------------------------------
   The left column is the RECORD OF TRAINING: the clusters the trainee sat, with
   the unit titles and nominal hours exactly as the plan words them. The right
   column is the COMPETENCY PROFILE: what the graduate can do, grouped into the
   technical areas of the occupation. Left is what was taught; right is what an
   employer reads. (Before these were seeded the renderer fell back to echoing
   the clusters, so both columns printed the identical list.)

   Every competency category carries `fromUnits` — the plan units its statements
   summarise. That is provenance, never printed, and the unit tests use it to
   prove two things: no statement claims a unit outside the plan, and no core
   unit the trainee was assessed against goes unrepresented. So the wording is
   the Centre's, but the substance can only be what the plan assesses.

   CESTISCore.certTemplate.deriveCompetencies still exists as the fallback for a
   course with no seed (and for anything an administrator types by hand, which
   always wins).

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
        'Perform hair styling services' ] },
      competencies: [
        { category: 'Facial and Skin Care Therapy', items: [
          'Prepare the client and the treatment area, and perform facial treatments to spa standard',
          'Design and apply facial make-up to suit the client, the skin type and the occasion',
          'Provide lash and brow treatments, and temporary epilation and bleaching treatments',
          'Apply paraffin wax treatments safely' ],
          fromUnits: [
            'Perform facial treatment', 'Design and apply facial make-up', 'Provide lash and brow treatment',
            'Provide temporary epilation and bleaching treatments', 'Provide paraffin wax treatment' ] },
        { category: 'Nail Technology', items: [
          'Provide manicure and pedicure services, including hand and foot massage',
          'Apply and maintain acrylic and gel nail enhancements',
          'Design and apply nail art to client specification' ],
          fromUnits: [
            'Provide manicure and pedicure service', 'Apply acrylic nail enhancement',
            'Apply gel nail enhancement', 'Apply nail art' ] },
        { category: 'Massage Therapy Foundations', items: [
          'Apply foundation knowledge of massage therapy and its effects on the body',
          'Apply knowledge of the development of massage to spa practice' ],
          fromUnits: [
            'Acquire foundation knowledge of massage therapy', 'Apply knowledge of the history of massage' ] },
        { category: 'Spa Health, Safety and Infection Control', items: [
          'Provide advanced first aid in response to a workplace emergency',
          'Comply with infection prevention and control policies and procedures',
          'Protect self and clients against communicable diseases in the workplace' ],
          fromUnits: [
            'Provide advance first aid', 'Comply with infection prevention and control policies and procedures',
            'Protect self against communicable diseases in the workplace' ] },
        { category: 'Spa Retail and Financial Operations', items: [
          'Sell spa products and services and advise clients on their use',
          'Conduct financial transactions and perform the computations the spa requires',
          'Perform stock control procedures and maintain spa inventory' ],
          fromUnits: [
            'Sell products and services', 'Conduct financial transactions',
            'Perform stock control procedures', 'Perform mathematical computations' ] },
        { category: 'Client Care and Professional Communication', items: [
          'Receive, direct, schedule and check out clients professionally',
          'Communicate and interact effectively with clients and colleagues',
          'Provide quality customer service and handle client concerns with tact',
          'Display sound human relations skills in a diverse spa environment' ],
          fromUnits: [
            'Communicate and interact effectively in the workplace', 'Apply language and communication skills',
            'Receive and direct clients', 'Provide quality customer/client service',
            'Schedule and check out clients', 'Display human relations skills' ] },
        { category: 'Digital and Entrepreneurial Practice', items: [
          'Use advanced features of computer applications in spa administration',
          'Use social media tools to promote spa services and engage clients',
          'Craft a personal entrepreneurial strategy for a spa enterprise',
          'Reflect on and improve own professional practice' ],
          fromUnits: [
            'Perform advanced features of computer applications', 'Use social media tools for collaboration and engagement',
            'Craft personal entrepreneurial strategy', 'Reflect on and improve own professional practice' ] },
        { category: 'Additional Spa Services', elective: true, items: [
          'Perform face shave services',
          'Perform hair styling services',
          'Hold a basic conversation with clients in a foreign language' ],
          fromUnits: [
            'Perform face shave', 'Perform hair styling services',
            'Develop and apply conversational skills in a foreign language' ] }
      ]
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
        'Develop and apply conversational skills in a foreign language' ] },
      competencies: [
        { category: 'Hair Care and Salon Preparation', items: [
          'Plan and organize salon work and prepare clients for service',
          'Perform shampooing, conditioning and basic hair and scalp treatments',
          'Perform head, neck and shoulder massage, and wet hair styling and roller placement',
          'Maintain a safe, clean and efficient work environment' ],
          fromUnits: [
            'Plan and organize work', 'Prepare clients for salon service',
            'Perform shampooing and conditioning services', 'Perform head, neck and shoulder massage',
            'Perform wet hair styling and roller placement', 'Maintain a safe, clean and efficient work environment',
            'Perform basic hair and scalp treatments' ] },
        { category: 'Chemical Services and Hair Shaping', items: [
          'Consult with clients and diagnose hair and scalp conditions before a chemical service',
          'Perform chemical straightening and permanent wave services',
          'Provide permanent and semi-permanent hair colour services',
          'Perform hair shaping to suit the client’s features and hair type' ],
          fromUnits: [
            'Consult with clients and diagnose hair and scalp conditions',
            'Utilize sensory skills in beauty services for optimal client experience',
            'Perform chemical straightening services', 'Perform permanent wave services',
            'Provide permanent hair colour services', 'Perform semi-permanent hair colour services',
            'Perform hair shaping' ] },
        { category: 'Colour, Thermal and Styling Services', items: [
          'Perform temporary hair colour services',
          'Perform thermal straightening, curling and waving',
          'Perform hair braiding and hair styling services',
          'Maintain wigs and hair pieces, and advise clients on retail beauty care products' ],
          fromUnits: [
            'Perform temporary hair colour services', 'Perform thermal straightening, curling and waving',
            'Perform hair braiding services', 'Perform hair styling services',
            'Maintain wigs and hair pieces', 'Provide advice on retail beauty care products' ] },
        { category: 'Nail Care Services', items: [
          'Apply knowledge of nail science to nail services',
          'Provide manicure, pedicure and paraffin wax services',
          'Design and apply nail art' ],
          fromUnits: [
            'Apply knowledge of nail science to nail services', 'Provide manicure and pedicure service',
            'Provide manicure and pedicure services', 'Provide paraffin wax treatment', 'Apply nail art' ] },
        { category: 'Facial and Make-up Services', items: [
          'Perform facial treatments and face shave services',
          'Design and apply facial make-up',
          'Provide lash and brow treatment',
          'Carry out temporary epilation and bleaching treatments' ],
          fromUnits: [
            'Perform facial treatment', 'Perform face shave', 'Design and apply facial make-up',
            'Provide lash and brow treatment', 'Provide temporary epilation and bleaching treatments' ] },
        { category: 'Salon Reception and Client Care', items: [
          'Receive, direct, schedule and check out clients',
          'Provide quality customer service and sell salon products and services',
          'Apply language and communication skills and contribute to effective workplace relationships',
          'Collaborate in a creative process with colleagues and clients' ],
          fromUnits: [
            'Apply language and communication skills', 'Collaborate in a creative process',
            'Contribute to effective workplace relationships', 'Provide quality customer/client service',
            'Receive and direct clients', 'Schedule and check out clients', 'Sell products and services' ] },
        { category: 'Salon Business and Professional Practice', items: [
          'Conduct financial transactions and perform the computations a salon requires',
          'Perform stock control and comply with regulatory and taxation requirements',
          'Craft a personal entrepreneurial strategy and undertake research and analysis for the business',
          'Manage time and exercise professionalism and ethical behaviour',
          'Use advanced computer applications and social media tools in salon administration' ],
          fromUnits: [
            'Perform mathematical computations', 'Conduct financial transactions', 'Undertake research and analysis',
            'Craft personal entrepreneurial strategy', 'Perform stock control procedures',
            'Comply with regulatory and taxation requirements', 'Manage time',
            'Exercise professionalism and ethical behaviour', 'Use advanced features of computer applications',
            'Use social media tools for collaboration and engagement' ] },
        { category: 'Additional Cosmetology Skills', elective: true, items: [
          'Perform hair shaping on excessively curly hair',
          'Research interior decoration and design influences for the salon',
          'Hold a basic conversation with clients in a foreign language' ],
          fromUnits: [
            'Perform hair shaping on excessively curly hair', 'Research interior decoration and design influences',
            'Develop and apply conversational skills in a foreign language' ] }
      ]
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
      ],
      competencies: [
        { category: 'Electrical Safety and Work Planning', items: [
          'Follow occupational health and safety principles and apply basic electrical safety on every job',
          'Shut down and isolate machines and equipment safely before working on them',
          'Plan a routine task and a complete work activity, including sequence and materials' ],
          fromUnits: [
            'Follow principles of Occupational Health and Safety (OH&S) in work environment',
            'Apply basic electrical safety', 'Plan to undertake a routine task', 'Plan a complete work activity',
            'Shut down/isolate machines/equipment' ] },
        { category: 'Tools, Measurement and Testing', items: [
          'Select, use and maintain hand, power and marking-out tools for electrical work',
          'Use graduated, electrical/electronic and industrial instrumentation measuring devices',
          'Carry out basic testing and inspection of completed electrical installations' ],
          fromUnits: [
            'Use and maintain hand and power tools for electrical work', 'Use and maintain graduated measuring devices',
            'Use marking out tools', 'Use electrical/electronic measuring devices',
            'Use industrial instrumentation measuring devices',
            'Perform basic testing and inspection on electrical installations' ] },
        { category: 'Drawings, Standards and Circuit Design', items: [
          'Draw and interpret sketches, simple drawings and standard electrical drawings',
          'Use electrical software to produce simple circuit drawings',
          'Interpret electrical standards, specifications and manuals, and apply the principles and practices of electrical installation' ],
          fromUnits: [
            'Draw and interpret sketches and simple drawings', 'Interpret and draw standard electrical drawings',
            'Use electrical software to draw simple circuits', 'Interpret electrical standard, specifications and manuals',
            'Apply principles and practices in electrical installation' ] },
        { category: 'Wiring Systems and Conduit Installation', items: [
          'Prepare for, install, terminate and connect electrical wiring systems',
          'Cut, bend and install conduits, trunking and cable tray support systems',
          'Terminate basic signal, data and specialist cables, and solder and de-solder components' ],
          fromUnits: [
            'Prepare for electrical conduits/wiring installation', 'Install, terminate and connect electrical wiring systems',
            'Cut, bend and install electrical conduits', 'Cut, fit and install trunking system',
            'Prepare and install basic cable trays', 'Terminate basic signal and data cables',
            'Terminate and connect specialist cables',
            'Perform manual soldering/de-soldering of electrical/electronic components' ] },
        { category: 'Distribution, Machinery and Equipment Installation', items: [
          'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
          'Install electrical and electronic apparatus, machinery, fixtures and secondary wiring' ],
          fromUnits: [
            'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
            'Install electrical and electronic apparatus, machinery, fixtures and secondary wiring' ] },
        { category: 'Fault Finding, Repair and Maintenance', items: [
          'Locate, repair and rectify faults in electrical circuits',
          'Troubleshoot and repair basic electrical and electronic apparatus',
          'Dismantle and reassemble electromechanical components' ],
          fromUnits: [
            'Locate and repair/rectify electrical circuits', 'Troubleshoot and repair basic electrical/electronic apparatus',
            'Dismantle and reassemble electromechanical components' ] },
        { category: 'Workplace Communication, Computation and Business', items: [
          'Apply language and communication skills and provide quality customer service',
          'Write basic technical reports on the work carried out',
          'Perform mathematical computations, basic statistics and graphical techniques for electrical work',
          'Prepare quotations, order materials and craft a personal entrepreneurial strategy',
          'Use advanced computer applications and social media tools, and exercise professionalism and ethical behaviour' ],
          fromUnits: [
            'Apply language and communication skills', 'Write basic technical reports', 'Provide quality customer service',
            'Perform mathematical computations',
            'Use basic graphical techniques and perform simple statistical computations (Basic)',
            'Exercise professionalism and ethical behaviour', 'Craft personal entrepreneurial strategy',
            'Prepare quotations', 'Order materials', 'Use advanced features of computer applications',
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
        'Perform machining operations using horizontal and/or vertical boring machines' ] },
      competencies: [
        { category: 'Workshop Safety, Tools and Machines', items: [
          'Follow occupational health and safety principles in the welding workshop',
          'Select, use and maintain hand tools, power tools and graduated measuring devices',
          'Use workshop machines for basic operations and mark out work accurately' ],
          fromUnits: [
            'Follow principles of Occupational Health and Safety (OH&S) in work environment',
            'Use hand and power tools', 'Use and maintain graduated measuring devices',
            'Use workshop machines for basic operations', 'Use marking out tools' ] },
        { category: 'Engineering Drawing and CAD', items: [
          'Draw and interpret sketches, geometric shapes and basic engineering drawings',
          'Produce basic mechanical drawings and 2-D drawing elements using CAD software',
          'Interpret standard specifications and manuals before fabricating or welding' ],
          fromUnits: [
            'Draw and interpret sketches and simple drawings', 'Develop basic geometric shapes',
            'Prepare basic engineering drawing', 'Prepare basic mechanical drawings',
            'Operate computer aided design (CAD) to produce basic drawing elements',
            'Interpret standard specifications and manuals' ] },
        { category: 'Welding — Manual Metal Arc and Oxyacetylene', items: [
          'Set up and prepare for oxyacetylene and metal arc welding processes',
          'Weld in the flat and horizontal positions using manual metal arc welding (MMAW)',
          'Perform basic and advanced oxyacetylene (OAW) welding',
          'Perform brazing and silver soldering' ],
          fromUnits: [
            'Prepare for oxyacetylene/metal arc welding processes', 'Perform brazing and/or silver soldering',
            'Perform basic welding using manual metal arc welding process (MMAW)',
            'Perform basic welding using oxyacetylene welding process (OAW) - fuel gas welding',
            'Perform weld in the flat and horizontal positions using manual metal arc welding process (MMAW)',
            'Perform advanced welding using oxyacetylene welding process (OAW)' ] },
        { category: 'Welding — MIG, TIG and Flux Cored Processes', items: [
          'Weld using the gas metal arc welding process (GMAW/MIG)',
          'Weld in flat and horizontal positions using flux cored arc welding (FCAW)',
          'Weld in flat and horizontal positions using gas tungsten arc welding (GTAW/TIG)' ],
          fromUnits: [
            'Weld using gas metal arc welding process (GMAW) - metal inert gas (MIG)',
            'Perform weld in flat and horizontal positions using flux cored arc welding process (FCAW)',
            'Perform weld in flat and horizontal positions using gas tungsten metal arc welding process (GTAW) - tungsten inert gas (TIG)' ] },
        { category: 'Cutting, Forming and Fabrication', items: [
          'Carry out mechanical cutting, manual heating, thermal cutting, gouging and shaping',
          'Mark off structural fabrication and shapes, and classify the engineering materials used',
          'Undertake fabrication, forming, bending and shaping, and assemble fabricated components' ],
          fromUnits: [
            'Carry out mechanical cutting operations (basic)', 'Perform manual heating, and thermal cutting',
            'Perform advanced manual thermal cutting, gouging and shaping',
            'Mark off/out structural fabrication and shapes', 'Classify engineering materials (basic)',
            'Undertake fabrication, forming, bending and shaping', 'Assemble fabricated components' ] },
        { category: 'Work Planning and Quality Assurance', items: [
          'Plan a complete work activity from drawing to finished fabrication',
          'Apply quality standards and procedures to welded and fabricated work' ],
          fromUnits: [
            'Plan a complete work activity', 'Apply quality standards and procedures' ] },
        { category: 'Workplace Communication, Computation and Business', items: [
          'Apply language and communication skills, display human relations skills and provide quality customer service',
          'Write basic technical reports and perform the mathematical computations the trade requires',
          'Prepare quotations, order materials and craft a personal entrepreneurial strategy',
          'Use computer applications, mobile IT devices and online networks in the workplace',
          'Manage personal stress and time, and exercise professionalism and ethical behaviour' ],
          fromUnits: [
            'Apply language and communication skills', 'Write basic technical reports', 'Provide quality customer service',
            'Display human relations skills', 'Perform mathematical computations', 'Prepare quotations', 'Order materials',
            'Craft personal entrepreneurial strategy', 'Use mobile IT devices', 'Perform basic computer applications',
            'Participate in online networks and social media', 'Manage personal stress in the workplace',
            'Plan and apply time management strategies', 'Exercise professionalism and ethical behaviour' ] },
        { category: 'Machine Operations', elective: true, items: [
          'Apply introductory machine programming techniques',
          'Perform levelling and alignment of machines and engineering components',
          'Perform machining operations using horizontal and/or vertical boring machines' ],
          fromUnits: [
            'Apply introductory machine programming techniques',
            'Perform levelling and alignment of machines and engineering components',
            'Perform machining operations using horizontal and/or vertical boring machines' ] }
      ]
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
        'Maintain store security and cleanliness' ] },
      competencies: [
        { category: 'Front Office, Reservations and Guest Accounts', items: [
          'Provide accommodation reception services, receive and process reservations and carry out rooming procedures',
          'Maintain guest accounts, prepare accounts for departure and process cash and non-cash transactions',
          'Provide bell services, customised guest services and access to external services',
          'Respond to guest requests and complaints, and promote and up-sell products and services' ],
          fromUnits: [
            'Carry out rooming procedures', 'Provide bell services', 'Respond to guest related complaints and requests',
            'Maintain guests’ accounts', 'Prepare customer accounts and deal with departures',
            'Process cash and non-cash transactions', 'Receive and process reservations',
            'Provide accommodation reception services', 'Facilitate access to external services',
            'Promote and up-sell products and services', 'Provide customized guests services' ] },
        { category: 'Housekeeping, Laundry and Linen Services', items: [
          'Prepare guest rooms and offices to property standard',
          'Clean public areas, floors, walls, furniture and soft furnishings',
          'Provide laundry and linen room services, and repair and recycle linen',
          'Apply environmentally sustainable work practices in housekeeping' ],
          fromUnits: [
            'Clean public areas', 'Clean floors, walls, furniture and furnishings',
            'Clean and maintain soft floor and furnishings', 'Prepare guests rooms', 'Prepare offices',
            'Provide laundry service', 'Apply environmentally sustainable work practices',
            'Provide linen room services', 'Repair and recycle linen' ] },
        { category: 'Food Preparation and Cookery', items: [
          'Use knives safely and apply basic methods of cookery to prepare and present simple dishes',
          'Prepare and cook poultry, meat and seafood, and prepare stocks, sauces and soups',
          'Prepare and present appetizers, salads, sandwiches, vegetables, fruits, eggs and farinaceous dishes',
          'Clean and maintain kitchen premises and equipment' ],
          fromUnits: [
            'Prepare dishes using basic methods of cookery', 'Organize, prepare and present simple dishes',
            'Prepare and cook poultry dishes', 'Prepare and cook meat and seafood', 'Prepare stocks, sauces and soups',
            'Use knives for basic task in the kitchen environment', 'Prepare and present sandwiches',
            'Prepare and present appetizers and salads', 'Prepare vegetables, fruits, eggs and farinaceous dishes',
            'Clean kitchen premises and equipment' ] },
        { category: 'Pastry, Baking and Desserts', items: [
          'Prepare and produce pastries, cakes and puddings',
          'Prepare and produce yeast goods',
          'Prepare and present desserts' ],
          fromUnits: [
            'Prepare and produce pastries', 'Prepare and produce cakes and puddings products',
            'Prepare and produce yeast goods', 'Prepare and present desserts' ] },
        { category: 'Food and Beverage Service', items: [
          'Provide food and beverage service to guests',
          'Prepare and serve non-alcoholic beverages',
          'Receive and store stock for service' ],
          fromUnits: [
            'Provide food and beverage service', 'Prepare and serve non-alcoholic beverages',
            'Receive and store stock' ] },
        { category: 'Hospitality Compliance and Industry Practice', items: [
          'Comply with occupational health and safety, security and hygiene practices',
          'Comply with the legislative and regulatory requirements of the hospitality industry',
          'Develop and update hospitality industry and job knowledge, including Team Jamaica requirements' ],
          fromUnits: [
            'Comply with the occupational health and safety, security and hygiene practices',
            'Comply with the relevant legislative and regulatory requirements in hospitality',
            'Develop and update hospitality industry/job knowledge',
            'Apply knowledge of Team Jamaica requirements in the workplace' ] },
        { category: 'Guest Relations and Professional Practice', items: [
          'Apply the principles of customer service and work with colleagues and customers in a culturally diverse environment',
          'Apply language and communication skills, including basic conversation in a foreign language',
          'Apply professional codes of conduct and ethics, and manage personal stress, time and self-management',
          'Perform the mathematical computations the job requires and respond to familiar workplace problems' ],
          fromUnits: [
            'Operate in a culturally diverse work environment', 'Work with colleagues and customers',
            'Develop and apply conversational skills in a foreign language',
            'Develop and apply principles of professional codes of conduct & ethics',
            'Apply the principles of customer service', 'Enhance self-management skills for work',
            'Plan and apply time management strategies', 'Manage personal stress in the workplace',
            'Apply language and communication skills', 'Perform mathematical computation',
            'Respond to familiar workplace problems' ] },
        { category: 'Digital and Enterprise Skills', items: [
          'Use computer applications, mobile IT devices and online networks in hospitality work',
          'Craft a personal entrepreneurial strategy and develop an understanding of business operations',
          'Use strategies to identify job opportunities in the industry' ],
          fromUnits: [
            'Perform basic computer applications', 'Participate in online networks and social media',
            'Use mobile IT devices', 'Craft personal entrepreneurial strategy',
            'Develop an understanding of business operations', 'Use strategies to identify job opportunities' ] },
        { category: 'Records and Supplies Management', elective: true, items: [
          'Maintain housekeeping supplies',
          'Administer the current records systems',
          'Maintain store security and cleanliness' ],
          fromUnits: [
            'Maintain housekeeping supplies', 'Administer the current records systems',
            'Maintain store security and cleanliness' ] }
      ]
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
        'Perform testing on complex electrical installation' ] },
      competencies: [
        { category: 'Safety, Planning and Work Organisation', items: [
          'Follow occupational health and safety principles and isolate equipment before work begins',
          'Plan and organize routine tasks and complete work activities',
          'Perform manual handling, lifting and housekeeping duties safely on site' ],
          fromUnits: [
            'Follow principles of Occupational Health and Safety (OH&S) in work environment',
            'Plan to undertake a routine task', 'Plan a complete activity', 'Plan and organize work',
            'Shut down/isolate machines/equipment', 'Perform manual handling and lifting',
            'Perform housekeeping duties' ] },
        { category: 'Tools, Measurement and Technical Drawing', items: [
          'Select and use hand tools, power tools and marking-out equipment',
          'Use graduated and electrical/electronic measuring devices',
          'Draw and interpret sketches, prepare basic engineering drawings, and interpret standard specifications and manuals' ],
          fromUnits: [
            'Use hand tools', 'Use power tools', 'Use graduated measuring devices',
            'Use electrical/electronic measuring devices', 'Mark off/out (general engineering)',
            'Draw and interpret sketches and simple drawings', 'Interpret standard specifications and manuals',
            'Prepare basic engineering drawing' ] },
        { category: 'Electrical Installation and Cable Termination', items: [
          'Prepare for, install, terminate and connect electrical wiring, conduits, trunking and cable trays',
          'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
          'Install electrical and electronic machinery, appliances and fixtures',
          'Terminate signal, data and specialist cables, and solder and de-solder components' ],
          fromUnits: [
            'Install terminate and connect electrical wiring', 'Cut bend and install electrical conduits',
            'Prepare for electrical conduits/wiring installation', 'Cut fit and install trunking system',
            'Prepare and install basic cable trays',
            'Install distribution panels, metering sockets, terminal mains and meter earthing systems',
            'Install electrical/electronic machinery appliances, fixtures',
            'Terminate signal and data cables (basic)', 'Terminate and connect specialist cables',
            'Perform manual soldering/de-soldering – electrical/electronic components' ] },
        { category: 'Diagnosis, Repair and Maintenance', items: [
          'Diagnose and repair faults in electrical and electronic systems, circuits and secondary wiring',
          'Check, identify, isolate and rectify malfunctioning electrical machinery, appliances and fixtures',
          'Disconnect and reconnect fixed-wired machinery and attach flexible cables and plugs',
          'Install and maintain electrical equipment, electronic equipment and distribution circuits' ],
          fromUnits: [
            'Perform basic repair to electrical/electronic apparatus',
            'Disconnect and reconnect fixed wired electrical machinery appliance and fixtures',
            'Attach flexible cables & plugs to electrical machinery appliance and fixtures',
            'Fault find and repair/rectify basic electrical circuits and secondary wiring',
            'Check/identify/isolate/rectify malfunctioning electrical machinery appliances and fixtures',
            'Install and maintain electrical equipment',
            'Install and maintain electronic electrical equipment and distribution circuits',
            'Diagnose and repair faults in electrical and electronic systems' ] },
        { category: 'Inspection, Testing and Quality', items: [
          'Perform inspection and carry out testing of electrical installations',
          'Maintain quality systems within a team' ],
          fromUnits: [
            'Perform inspection (basic)', 'Perform testing and inspection of electrical installations',
            'Maintain quality systems within a team' ] },
        { category: 'Project Coordination and Leadership', items: [
          'Coordinate and manage basic electrical installation projects, from planning to hand-over',
          'Coordinate the installation of wiring support infrastructure, cables, fixtures, equipment and ancillary apparatus',
          'Purchase materials and operate in an autonomous team environment',
          'Support leadership in the workplace' ],
          fromUnits: [
            'Coordinate and manage basic installation projects',
            'Plan for wiring and installation of electrical/electronic machinery appliances and fixtures',
            'Coordinate the installation of electrical wiring support system infrastructure',
            'Coordinate the installation of electrical cable and fixture',
            'Coordinate the installation of electrical equipment, ancillary apparatus and secondary wiring',
            'Purchase materials', 'Operate in an autonomous team environment',
            'Support leadership in the workplace' ] },
        { category: 'Communication, Reporting and Computation', items: [
          'Undertake interactive workplace communication and perform internal and external customer service',
          'Write basic technical reports on the work carried out',
          'Perform the related computations the trade requires' ],
          fromUnits: [
            'Undertake interactive workplace communication', 'Perform internal and external customer service',
            'Write technical reports (basic)', 'Perform related computations – basic',
            'Perform related computations' ] },
        { category: 'Specialist Electrical Skills', elective: true, items: [
          'Determine, plan, interpret and carry out electrical installation design requirements',
          'Evaluate electrical installations and perform testing on complex installations',
          'Diagnose and repair faults in electrical equipment, including attending to breakdowns in hazardous areas',
          'Coordinate the installation of substation plant and apparatus, and manage commissioning processes',
          'Install below-ground communication cables and use industrial instrumentation measuring devices',
          'Support operational plans, continuous improvement systems and on-the-job training',
          'Craft a personal entrepreneurial strategy, order materials and carry out data entry and retrieval',
          'Assemble and disassemble scaffolding for access, classify engineering materials and prepare basic engineering drawings' ],
          fromUnits: [
            'Determine and plan for electrical installation requirements', 'Interpret and carry out electrical design',
            'Evaluate electrical installation', 'Perform testing on complex electrical installation',
            'Diagnose & repair faults in electrical equipment', 'Attend to breakdown in hazardous area',
            'Coordinate the installation of substation plant and apparatus',
            'Coordinate and manage commissioning processes', 'Install below ground communication cables',
            'Use industrial instrumentation measuring devices', 'Support operational plan',
            'Support continuous improvement systems and processes', 'Assist in the provision of on the job training',
            'Craft personal entrepreneurial strategy', 'Order materials', 'Carry out data entry and retrieval procedures',
            'Assemble & disassemble scaffolding to enable access to the work area',
            'Classify engineering materials (basic)', 'Prepare basic engineering drawing' ] }
      ]
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
      ],
      competencies: [
        { category: 'Workshop Safety, Planning and Work Practice', items: [
          'Follow occupational health and safety principles in the welding workshop',
          'Plan routine tasks and complete work activities',
          'Perform manual handling, lifting and housekeeping duties, and operate in an autonomous team' ],
          fromUnits: [
            'Follow principles of Occupational Health and Safety (OH&S) in work environment',
            'Plan to undertake a routine task', 'Plan a complete activity', 'Perform manual handling and lifting',
            'Perform housekeeping duties', 'Operate in an autonomous team environment' ] },
        { category: 'Tools, Measurement and Marking Out', items: [
          'Select, use and care for hand and power tools',
          'Use and maintain graduated measuring devices',
          'Mark off and mark out general engineering work accurately' ],
          fromUnits: [
            'Use hand tools', 'Use and care power tools', 'Use and maintain graduated measuring devices',
            'Mark off/out (general engineering)' ] },
        { category: 'Drawings, Specifications and Materials', items: [
          'Draw and interpret sketches and simple drawings, and develop basic geometric shapes',
          'Interpret standard specifications and manuals',
          'Classify the engineering materials used in fabrication and welding' ],
          fromUnits: [
            'Draw and interpret sketch and simple drawing', 'Develop geometric shapes (basic)',
            'Interpret standard specifications and manuals', 'Classify engineering materials (basic)' ] },
        { category: 'Cutting, Forming and Fabrication', items: [
          'Carry out mechanical cutting, manual heating and thermal cutting operations',
          'Perform advanced manual thermal cutting, gouging and shaping',
          'Undertake fabrication, forming, bending and shaping, and assemble fabricated components' ],
          fromUnits: [
            'Carry out mechanical cutting operations (basic)', 'Perform manual heating and thermal cutting',
            'Perform advanced manual thermal cutting, gouging and shaping',
            'Undertake fabrication, forming, bending and shaping (basic)',
            'Assemble fabricated components (basic)' ] },
        { category: 'Welding Processes', items: [
          'Prepare for oxyacetylene and metal arc welding processes',
          'Perform basic and advanced welding using the manual metal arc welding process (MMAW)',
          'Perform welding using the oxyacetylene welding process (OAW)',
          'Weld using the gas metal arc welding process (GMAW/MIG)',
          'Perform brazing and silver soldering' ],
          fromUnits: [
            'Prepare for oxyacetylene/metal arc welding processes',
            'Perform basic welding using manual metal arc welding process (MMAW)',
            'Perform advanced welding using manual metal arc welding process (MMAW)',
            'Perform basic welding using oxyacetylene welding process (OAW) - fuel gas welding',
            'Weld using gas metal arc welding process GMAW - metal inert gas (MIG)',
            'Perform brazing and/or silver soldering' ] },
        { category: 'Communication, Reporting and Computation', items: [
          'Undertake interactive workplace communication',
          'Write basic technical reports and carry out data entry and retrieval procedures',
          'Perform the related computations the trade requires' ],
          fromUnits: [
            'Undertake interactive workplace communication', 'Write technical reports (basic)',
            'Carry out data entry and retrieval procedures', 'Perform related computations (basic)',
            'Perform related computations' ] }
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

  /* Every unit title in a programme, in plan order. Used to check that the
     competency statements only ever claim units the plan actually assesses. */
  function seedUnits(seed, includeElectives) {
    if (!seed) return [];
    var out = [];
    (seed.clusters || []).forEach(function (c) {
      (c.units || []).forEach(function (u) { out.push(u); });
    });
    if (includeElectives && seed.electives) {
      (seed.electives.units || []).forEach(function (u) { out.push(u); });
    }
    return out;
  }

  /* The programme's TECHNICAL COMPETENCIES ACHIEVED, as the certificate prints
     them: a handful of technical areas, each stating what the graduate can do.
     `fromUnits` is provenance for the Centre and the tests — it is not printed —
     so it is dropped here, and `fromPlan` records which plan the statements
     came from so a re-seed can tell them apart from hand-written ones. */
  function seedCompetencies(seed, includeElectives) {
    if (!seed) return [];
    return (seed.competencies || [])
      .filter(function (c) { return includeElectives || !c.elective; })
      .map(function (c) {
        return {
          category: c.elective ? (c.category + ' (Electives)') : c.category,
          items: (c.items || []).slice(),
          fromPlan: seed.planCode || ''
        };
      });
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
    var withElectives = opts.includeElectives !== false;
    var clusters = seedClusters(seed, withElectives);
    return {
      courseFullName: seed.course,
      courseType: seed.courseType || 'Full-time',
      programmeCode: seed.planCode || '',
      modules: clusters,
      // The plan's own competency profile. Every statement is traceable to the
      // units above (see `fromUnits` in the seed data), so the certificate can
      // only claim what the trainee was actually assessed against.
      competencies: seedCompetencies(seed, withElectives),
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
        derived: !!s.clustersDerived,
        competencyAreas: (s.competencies || []).length,
        competencyStatements: (s.competencies || []).reduce(function (a, c) { return a + (c.items || []).length; }, 0)
      };
    });
  }

  var api = {
    CERT_TEMPLATE_SEED: CERT_TEMPLATE_SEED,
    findSeed: findSeed,
    seedClusters: seedClusters,
    seedUnits: seedUnits,
    seedCompetencies: seedCompetencies,
    seedDuration: seedDuration,
    templateContentFor: templateContentFor,
    seedSummary: seedSummary
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CESTISCertSeed = api;

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
