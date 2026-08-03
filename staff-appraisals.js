/* ============================================================================
   staff-appraisals.js — Staff Performance Appraisals module (Administrator).

   Implements the HAZARD SKILLS TRAINING CENTRE "Performance Appraisal
   Instrument" (HEART/NSTA Trust Performance Management System) inside the
   CESTIS LMS:

   - Admin-only grading page (mounted from Pages/Staff-Appraisals.html via the
     cestis-mount feature system; logic lives here because innerHTML-injected
     fragments cannot run <script>).
   - One appraisal per staff member per appraisal cycle (April – March).
   - Section 1 objectives are per-position templates taken verbatim from the
     Centre's appraisal instruments and the Job Descriptions for the five CTI
     posts; Sections 2 & 3 are the instrument's fixed performance factors.
   - Auto-calculation: section totals, factor averages (factor total ÷ number
     of criteria), final score = total × 100 ÷ 385 (supervisory) or ÷ 280
     (non-supervisory), performance category and payment-reward %.
   - Live preview + print: an exact page-for-page replica of the Word
     instrument (portrait front page, landscape Section 1, Times New Roman),
     printable to PDF from a dedicated print window.
   - Annual due indicator: the appraisal window for a cycle opens 1 March of
     the cycle's closing year and is due by 30 April; the Administrator gets a
     bell notification and a dashboard card listing staff not yet appraised.
   - Each staff member sees their own completed grade on their dashboard.

   Data lives in CESTISStore under 'cestisStaffAppraisals' (the cestis* prefix
   survives the voctrain_* logout wipe, like the finance/cashbook modules, and
   is included in the local JSON backup).

   Pure calculation/template helpers are Node-safe and exported for unit tests
   (tests/staff-appraisals.test.js).
   ============================================================================ */
(function (root) {
  'use strict';

  /* ==========================================================================
     SECTION 2 — KEY JOB PERFORMANCE FACTORS (fixed by the instrument, 180 max)
     Text is verbatim from the Centre's appraisal instruments.
     ========================================================================== */
  var SAPP_SECTION2 = [
    { name: 'Quality of Work', max: 25,
      desc: '(The extent to which the employee efficiently utilizes available resources  to consistently produce work of a high standard)',
      bullets: [
        'Demonstrates accuracy, thoroughness and reliability',
        'Produces work at the established standard in a timely manner',
        'Demonstrates the necessary job competence (knowledge, skills and attitudes)',
        'Plans, organizes and analyzes work assignments for optimum results',
        'Utilizes resources in a cost effective and efficient manner'
      ] },
    { name: 'Customer Satisfaction', max: 25,
      desc: '(The extent  to which the employee represents the organization in a positive, respectful and professional manner by responding to the diverse needs of the external and internal customers)',
      bullets: [
        'Offers solution-oriented responses to meet customer needs and minimize problems',
        'Assumes responsibility for customers satisfaction',
        'Encourages customer feedback and build relationships',
        'Maintains pleasant and professional disposition at all times',
        'Responds to customers’ request in the agreed or established timeframe'
      ] },
    { name: 'Teamwork', max: 20,
      desc: '(The extent to which the employee recognizes that total participation and commitment to team excellence brings shared success)',
      bullets: [
        'Contributes to the development of other members of the team',
        'Contributes willingly to non-core activities',
        'Contributes ideas to improve the output of the team',
        'Works harmoniously with the team to help prevent and or resolve conflicts'
      ] },
    { name: 'Relevance', max: 20,
      desc: '(The extent to which the employee illustrates an understanding of the relation of his/her job to the organization’s vision, mission and values)',
      bullets: [
        'Demonstrates knowledge of and supports the organization’s vision, mission and values.',
        'Contributes to cross-functional activities.',
        'Shows willingness to review processes and procedures in order to respond to the dynamic nature of the organization.',
        'Informs him/herself of current trends to improve job performance'
      ] },
    { name: 'Problem Analysis and Decision Making', max: 20,
      desc: '(The extent to which the employee analyses problems/situations and identifies workable solutions, and makes constructive decisions in a timely manner.)',
      bullets: [
        'Uses logical and sound judgement in making timely decisions',
        'Demonstrates creativity in solving problems',
        'Accepts responsibility and accountability for decisions taken',
        'Shows initiative in problem solving and decision making'
      ] },
    { name: 'Communication', max: 20,
      desc: '(The extent to which the employee effectively listens, conveys and receives ideas, information and direction at varying levels.)',
      bullets: [
        'Speaks clearly and formulates ideas',
        'Clarifies and confirms understanding of instructions and information',
        'Makes written communication clear and easy to understand',
        'Seeks, acts on and provides constructive feedback to improve job performance'
      ] },
    { name: 'Professional Development', max: 15,
      desc: '(The extent to which the employee embraces lifelong learning as a path towards professional development.)',
      bullets: [
        'Demonstrates initiative in seeking out developmental opportunities',
        'Participates in developmental activities to improve competence',
        'Develops/reviews career and professional development plan in collaboration with manager/supervisor'
      ] },
    { name: 'Professionalism', max: 15,
      desc: 'The extent to which the behaviour/conduct of the employee reflects and demonstrates the core values of the organization',
      bullets: [
        'Demonstrates honesty, integrity and trustworthiness in dealing with internal and external customers',
        'Adheres to the organisation’s dress code and behaves in a manner consistent with its image and culture.',
        'Ensures confidentiality and integrity of data and information'
      ] },
    { name: 'Safety and Security', max: 10,
      desc: '(The extent to which the employee adheres to safety, security, and health policies/standards and procedures.)',
      bullets: [
        'Adheres to safety, security, health and environmental policies/standards and procedures.',
        'Ensures proper use and care of equipment and safety attire.'
      ] },
    { name: 'Attendance and Punctuality', max: 10,
      desc: '(The extent to which the employee is present on the job, except for approved leave, and adheres to the stipulated time for work and work related activities.)',
      bullets: [
        'Maintains regular attendance',
        'Reports to work and other job related activities on time'
      ] }
  ];

  /* ==========================================================================
     SECTION 3 — LEADERSHIP AND MANAGEMENT PERFORMANCE FACTORS (105 max,
     scored for supervisory staff only; printed on every instrument exactly as
     in the source documents).
     ========================================================================== */
  var SAPP_SECTION3 = [
    { name: 'Leadership', max: 35,
      desc: '(The extent to which the employee promulgates the organisation’s vision and values;  sets goals; influences; coaches, motivates and empowers staff).',
      bullets: [
        'Motivates employees to think creatively and work independently',
        'Counsels employees in both positive and negative circumstances',
        'Creates environment that facilitates employees in achieving  the unit and individual goals',
        'Provides policy guidelines and directions.',
        'Communicates divisional/departmental goals and manages compliance in a clear and consistent manner.',
        'Leads change management process  in accordance with the organization’s change management protocol',
        'Proactively puts forward organisation development ideas to improve performance'
      ] },
    { name: 'Planning and Implementing', max: 35, avgLabel: 'Planning and Implementation',
      desc: '(The extent to which the employee anticipates work needs, budgets and manages resources effectively and efficiently to attain predetermined goals and objectives.)',
      bullets: [
        'Develops and manages projects',
        'Collects, analyses and uses data to inform decision making',
        'Contributes to strategic and log-frame planning to ensure alignment with corporate objectives',
        'Forecasts/anticipates work needs and prioritizes duties in a manner consistent with organisational objectives',
        'Creates accurate and realistic budgets to meet changing organisational / departmental needs',
        'Tracks and manages expenses and provides timely reports',
        'Uses  resources effectively and efficiently to enhance department and /or job performance'
      ] },
    { name: 'Performance Management', max: 20,
      desc: '(The extent  to which the employee provides timely and objective performance feedback and support to ensure congruence with organisation’s goals.)',
      bullets: [
        'Provides formal and informal performance feedback and support on a regular basis',
        'Acknowledges good performance and discusses performance problems',
        'Conducts fair and impartial appraisal interviews and prepares and submits timely evaluations',
        'Defines and communicates standards of performance and assists employees in achieving these standards'
      ] },
    { name: 'Staff Development', max: 15,
      desc: '(The extent  to which the employee provides opportunities to challenge staff’s capabilities and develops the competencies necessary for career development.)',
      bullets: [
        'Facilitates the development and implementation of employees’ Career Plans',
        'Facilitates developmental activities/programmes to improve employees’ performance',
        'Encourages and supports staff participation in job related activities'
      ] }
  ];

  /* ==========================================================================
     SECTION 1 TEMPLATES — one per position.
     'instructor' and 'coordinator' are verbatim from the Centre's existing
     instruments; the other four are built from the Job Descriptions and
     Specifications (KPI sections) for the CTI posts. Every template's weights
     sum to exactly 100 (asserted in tests).
     ========================================================================== */
  var SAPP_TEMPLATES = {
    coordinator: {
      label: 'Programme Coordinator / Project Manager',
      position: 'PROGRAMME COORDINATOR / PROJECT MANAGER',
      supervisory: true,
      section1: [
        { name: 'Cash Management', weight: 10, indicators: [
          ['Cashbook kept current and accurate for the period', 2],
          ['Bank reconciliation prepared monthly for the period', 2],
          ['No unauthorised virement for the period', 2],
          ['Subvention returns submitted within ten (10) working days of end of period.', 4]
        ] },
        { name: 'Training Management', weight: 18, indicators: [
          ['Orientation schedule prepared and submitted to CTI within five (5) days prior to the start of orientation.', 2],
          ['Lesson Plan(s) collected verified and approved five (5) working days prior to instruction.', 4],
          ['Enrolment registers submitted to Manager, CTI within 15 working days after commencement of cycle', 3],
          ['Instructors develop Training and Assessment Development Plan(s) (TADP) in accordance with ATO and submitted to CTI Manager within five (5) working days prior to commencement of training.', 4],
          ['Completers’ register(s) submitted to CTI Manager ten (10) working days after the end of the cycle.', 1],
          ['Two (2) Instructor class evaluations conducted per cycle.', 4]
        ] },
        { name: 'Assessment', weight: 12, indicators: [
          ['Trainees’ registration for assessment with NCTVET and payments completed and submitted to Manager CTI within ten (10) working days prior to NCTVET registration timeline.', 7],
          ['Continuous internal assessments conducted as per TADP in accordance with ATO.', 3],
          ['Maintain Continuous Assessment Grades.', 2]
        ] },
        { name: 'Enrolment and Certification', weight: 20, indicators: [
          ['90% of trainees enrolled certified at the end of training for the period', 20]
        ] },
        { name: 'Record Management', weight: 14, indicators: [
          ['Fixed asset inventory kept current', 2],
          ['Training material inventory kept accurate and current', 2],
          ['Personal file maintained for each staff member and trainee', 2],
          ['Develop and maintain a tracking system for Assessment results.', 4],
          ['All new recruit tested prior to start of cycle.', 2],
          ['Assessment documents are filed five (5) days on receipt from ATO.', 2]
        ] },
        { name: 'Operational Management', weight: 7, indicators: [
          ['Conduct bi-monthly staff meeting.', 1],
          ['Quality Assurance Meetings conducted quarterly.', 1],
          ['Instructors’ test items validated within two (2) days of receipt', 3],
          ['Each skill instructor to complete forty (40) hours of industry furlough on completion of cycle.', 2]
        ] },
        { name: 'Staff', weight: 2, indicators: [
          ['Maintain staff attendance register.', 1],
          ['Staff members to attend all CTI Workshops/Seminars/ Meetings as required.', 1]
        ] },
        { name: 'Accountability', weight: 17, indicators: [
          ['Financial Audit rating to be no less than 4 when conducted.', 10],
          ['Financial Audit recommendations implemented within five (5) days of receipt of formal report.', 3],
          ['Financial Audit response submitted within (5) working days after implementation.', 1],
          ['Physical facility to be maintained at NCTVET standard.', 3]
        ] }
      ]
    },

    asst_coordinator: {
      label: 'Assistant Programme Coordinator',
      position: 'ASSISTANT PROGRAMME COORDINATOR',
      supervisory: true,
      section1: [
        { name: 'Training Management', weight: 30, indicators: [
          ['Orientation schedule prepared and submitted to CTI within five (5) days prior to the start of orientation.', 4],
          ['Lesson plans collected, verified and approved five (5) working days prior to instruction.', 6],
          ['TADPs verified and forwarded for submission to the CTI Manager within five (5) working days prior to commencement of training.', 5],
          ['Two (2) instructor class evaluations conducted per cycle and outcomes recorded.', 5],
          ['Enrolment register verified in time for submission within fifteen (15) working days after commencement of cycle.', 3],
          ['Completers’ register verified in time for submission within ten (10) working days after the end of the cycle.', 3],
          ['Scheduled training hours delivered; lost delivery recovered through timetabled make-up sessions.', 4]
        ] },
        { name: 'Assessment', weight: 25, indicators: [
          ['Internal assessment schedule prepared for each cohort and aligned to the NCTVET assessment cycles.', 5],
          ['Continuous internal assessments conducted as per TADP in accordance with ATO; Continuous Assessment Grades maintained.', 6],
          ['Instructors’ test items validated within two (2) days of receipt.', 4],
          ['Candidate eligibility confirmed and assessment registration with payments submitted within ten (10) working days prior to the NCTVET registration timeline.', 6],
          ['External Verification arrangements coordinated; candidate portfolios complete, authenticated and traceable.', 4]
        ] },
        { name: 'Enrolment and Certification', weight: 20, indicators: [
          ['90% of trainees enrolled certified at the end of training for the period', 20]
        ] },
        { name: 'Monitoring and Quality Assurance', weight: 10, indicators: [
          ['Scheduled and unannounced classroom/workshop observations conducted and recorded on the approved instrument.', 4],
          ['Attendance, retention and progression monitored; Early Warning System operated and at-risk learners followed up.', 4],
          ['Corrective actions from audit, verification and monitoring visits implemented within the agreed timeframe.', 2]
        ] },
        { name: 'Record Management', weight: 6, indicators: [
          ['Assessment evidence register maintained; candidate portfolios complete and retrievable.', 2],
          ['Register of assessors and internal verifiers kept current, including certification status and expiry dates.', 2],
          ['All new recruits tested prior to start of cycle.', 2]
        ] },
        { name: 'Financial Records', weight: 5, indicators: [
          ['Cashbook entries and supporting vouchers maintained jointly with the Programme Coordinator, complete and producible to an auditor on request.', 3],
          ['Monthly bank reconciliation assisted and reconciling items investigated.', 2]
        ] },
        { name: 'Trainee Welfare', weight: 4, indicators: [
          ['Counselling referrals submitted to the HEART/NSTA Trust within two (2) working days of receipt of referral.', 2],
          ['Confidential referral log maintained and referral outcomes reported to the Programme Coordinator.', 2]
        ] }
      ]
    },

    admin_assistant: {
      label: 'Administrative Assistant',
      position: 'ADMINISTRATIVE ASSISTANT',
      supervisory: true,
      section1: [
        { name: 'Cash Management', weight: 10, indicators: [
          ['Subvention return prepared for approval and submission within ten (10) working days of the end of the period.', 4],
          ['Monthly bank reconciliation prepared for the Programme Coordinator’s review and signature.', 4],
          ['Administrative Clerk’s daily cash reconciliation verified and signed every working day.', 2]
        ] },
        { name: 'Training Management', weight: 12, indicators: [
          ['Enrolment register compiled and submitted to Manager, CTI within fifteen (15) working days after commencement of cycle.', 4],
          ['Completers’ register compiled and submitted to CTI Manager within ten (10) working days after the end of the cycle.', 4],
          ['Applications and registrations processed and entered on the learner management system on the day of receipt.', 4]
        ] },
        { name: 'Assessment', weight: 12, indicators: [
          ['Trainees’ registration for assessment with NCTVET, with payment evidence, compiled and submitted within ten (10) working days prior to the NCTVET registration timeline.', 6],
          ['Tracking system for assessment results developed, maintained and current.', 4],
          ['Assessment documents filed within five (5) days of receipt from the ATO.', 2]
        ] },
        { name: 'Enrolment, Certification and RBF Reporting', weight: 20, indicators: [
          ['Twelve (12) monthly monitoring reports and PMIS E-scorecard returns prepared and submitted on time for approval.', 8],
          ['Quarterly tranche claim evidence packs (enrolment registers, attendance records, completers’ registers, certification results) complete and submitted on time.', 6],
          ['Certification register reconciled against NCTVET results; certificates recorded, safeguarded and issued against signed receipts.', 6]
        ] },
        { name: 'Record Management', weight: 26, indicators: [
          ['Learner file created and maintained for every registered trainee; personal file maintained for every staff member.', 6],
          ['Electronic learner records agree with paper files; TMS enrolment data reconciled against learner files.', 4],
          ['Fixed asset inventory and training material inventory kept accurate and current.', 4],
          ['Certificates, Statements of Competence and transcripts receipted, safeguarded and released only on signed receipt.', 4],
          ['Minutes of bi-monthly staff meetings and quarterly Quality Assurance Meetings circulated within two (2) working days.', 4],
          ['Correspondence and action registers kept current; electronic records backed up daily.', 4]
        ] },
        { name: 'Operational Management', weight: 10, indicators: [
          ['Programme Coordinator’s diary, appointments, meetings and papers managed and confirmed daily.', 4],
          ['Directives issued by the Programme Coordinator followed up and status reported; slippage reported same day.', 3],
          ['Monthly audit of a sample of learner files conducted and errors corrected at source.', 3]
        ] },
        { name: 'Staff', weight: 5, indicators: [
          ['Administrative Clerk and Teacher’s Assistant (Store Room Keeper) supervised; daily sample checks of data entry performed.', 3],
          ['Staff attendance at all CTI workshops, seminars and meetings scheduled and recorded.', 2]
        ] },
        { name: 'Accountability', weight: 5, indicators: [
          ['Attendance audited against the ninety-five per cent (95%) requirement and exceptions reported.', 3],
          ['Register of every RBF deadline, submission and acknowledgement maintained and current.', 2]
        ] }
      ]
    },

    admin_clerk: {
      label: 'Administrative Clerk',
      position: 'ADMINISTRATIVE CLERK',
      supervisory: false,
      section1: [
        { name: 'Cash Management', weight: 25, indicators: [
          ['Cashbook kept current and accurate for the period.', 6],
          ['Daily cash reconciliation completed, verified and signed every working day.', 6],
          ['Pre-numbered receipt issued for every payment; nil unreceipted collections.', 5],
          ['All monies lodged in accordance with banking arrangements; nil cash held overnight.', 4],
          ['Fee ledger maintained per learner; outstanding balances listed and followed up as instructed.', 4]
        ] },
        { name: 'Enrolment and Data Entry', weight: 25, indicators: [
          ['Applicant and learner data entered on the learner management system within one (1) working day of receipt.', 8],
          ['Entries verified against source documents; data-entry error rate on checking and audit within the agreed standard.', 7],
          ['Enrolment register and waiting list maintained and reconciled weekly against the learner management system.', 5],
          ['Learner files created with correct reference and passed to the Administrative Assistant for checking.', 5]
        ] },
        { name: 'Attendance Records', weight: 20, indicators: [
          ['Attendance entered on the day of the session for one hundred per cent (100%) of sessions.', 8],
          ['Attendance registers issued at the start and collected at the end of every session.', 4],
          ['Learners with two (2) or more consecutive unexplained absences flagged to the Administrative Assistant and Assistant Programme Coordinator.', 4],
          ['Weekly and monthly attendance summaries prepared by cohort, programme and facilitator.', 4]
        ] },
        { name: 'Assessment Support', weight: 10, indicators: [
          ['Assessment fees collected, receipted and payment evidence provided in time for the NCTVET registration submission.', 6],
          ['Assessment documents filed within five (5) days of receipt from the ATO.', 4]
        ] },
        { name: 'Front Desk and Customer Service', weight: 10, indicators: [
          ['Telephone calls, visitors and enquiries handled promptly, courteously and accurately.', 4],
          ['WhatsApp, social media and telephone enquiries responded to within one (1) working day.', 3],
          ['Enquiry register maintained, recording source, follow-up and conversion to application.', 3]
        ] },
        { name: 'Record Management', weight: 8, indicators: [
          ['Staff attendance register maintained and current.', 3],
          ['Training material inventory movements recorded as items are issued and received.', 3],
          ['Receipts, registers and correspondence filed weekly and archived per the retention schedule.', 2]
        ] },
        { name: 'Staff', weight: 2, indicators: [
          ['Attends all staff meetings and CTI Workshops/Seminars/Meetings as required.', 2]
        ] }
      ]
    },

    teachers_assistant: {
      label: 'Teacher’s Assistant (Store Room Keeper)',
      position: 'TEACHER’S ASSISTANT (STORE ROOM KEEPER)',
      supervisory: false,
      section1: [
        { name: 'Training Support', weight: 20, indicators: [
          ['Training area prepared and safety-checked before the start of every session.', 8],
          ['Facilitator supported during demonstrations and practical work; individual guidance provided to learners.', 4],
          ['Training area restored to a clean, safe and ordered condition at the end of every session.', 4],
          ['Instructional aids, charts, models and job cards prepared as required.', 4]
        ] },
        { name: 'Attendance and Progress Records', weight: 20, indicators: [
          ['Attendance marked within the first ten (10) minutes of one hundred per cent (100%) of sessions; never recorded retrospectively.', 8],
          ['Signed registers submitted to the Administrative Clerk at the end of each session.', 4],
          ['Learner progress sheets current at the end of every training day.', 4],
          ['Learners falling behind, disengaging or in distress reported to the Facilitator the same day.', 4]
        ] },
        { name: 'Assessment Support', weight: 10, indicators: [
          ['Learner work collated and filed into candidate portfolios, dated and identified, complete ahead of ATO assessment.', 6],
          ['Practical assessment stations set up and dismantled under the direction of the Facilitator or Assessor.', 4]
        ] },
        { name: 'Retention and Certification Support', weight: 15, indicators: [
          ['First-line contact made with trainees flagged by the Early Warning System within one (1) working day and outcome reported.', 8],
          ['Early signs of disengagement identified and reported on the day observed; welfare concerns referred to the Assistant Programme Coordinator.', 7]
        ] },
        { name: 'Health and Safety', weight: 15, indicators: [
          ['Personal protective equipment available, serviceable and correctly worn for every practical activity.', 5],
          ['Pre-use checks of tools, machines and guards completed; defective items withdrawn, labelled and reported.', 5],
          ['Accidents, injuries and near misses recorded in the accident book on the day they occur.', 3],
          ['Waste, chemicals and sharps disposed of correctly; training areas maintained at the NCTVET standard.', 2]
        ] },
        { name: 'Store Room Keeping', weight: 18, indicators: [
          ['Store ledger/bin cards updated at the time of every receipt and issue, never retrospectively.', 4],
          ['Nil issues made without a requisition signed by the Facilitator or Assistant Programme Coordinator.', 3],
          ['Monthly stock count completed, reconciled to the store ledger and variances reported the same day.', 4],
          ['Nil unaccounted tools or equipment at the close of each day.', 3],
          ['Minimum stock levels monitored; nil practical sessions lost for want of materials held in stock.', 2],
          ['Store room secured and key accounted for at the close of every day.', 2]
        ] },
        { name: 'Staff', weight: 2, indicators: [
          ['Attends all staff meetings, briefings and CTI Workshops/Seminars/Meetings as required.', 2]
        ] }
      ]
    },

    instructor: {
      label: 'Instructor',
      position: 'INSTRUCTOR',
      supervisory: false,
      hasSkillArea: true,
      section1: [
        { name: 'Quality of training delivery improved', weight: 21, indicators: [
          ['Lesson Plan presented the 1st day of the week prior to use', 8],
          ['Attendance register marked daily by 10:00 am', 1],
          ['Trainee performance records (Grade Book) maintained according to ATO requirements', 6],
          ['Training and Assessment Development Plans(s) (TADP) developed accordance with ATO and submitted to CTI Co-ordinator within five (5) working days prior to training', 6]
        ] },
        { name: 'Trainee Management', weight: 6, indicators: [
          ['Trainees’ Allowance sheet prepared and presented to CTI Co-ordinator two (2) days after month ends', 2],
          ['Trainee material inventory kept accurate and current', 2],
          ['All internal test instruments inclusive of group assignments maintained in trainees’ portfolio.', 2]
        ] },
        { name: 'Personal Development', weight: 10, indicators: [
          ['Complete forty (40) hours of industry furlough after completion of training', 6],
          ['Attend all CTI Workshops/Seminars/ Meetings.', 2],
          ['Attend all staff meetings', 2]
        ] },
        { name: 'Enrolment and Certification', weight: 20, indicators: [
          ['90% of trainees enrolled certified at the end of training.', 20]
        ] },
        { name: 'Class Management', weight: 11, indicators: [
          ['Drop-out not to exceed 2%', 4],
          ['Assist in the planning and implementation of orientation exercise(s).', 3],
          ['Completers register submitted to CTI Co-ordinator one (1) week after the completion of training', 1],
          ['Develop and maintain a tracking system for assessment results.', 3]
        ] },
        { name: 'Instruction/ Facilitation', weight: 6, indicators: [
          ['Verify with trainees information on enrolment register(s) and signatures affixed within two (2) days of commencement of training.', 2],
          ['Training and Assessment Development Plan (TADP) displayed in classroom within three (3) working days of commencement of training.', 4]
        ] },
        { name: 'Assessment', weight: 26, indicators: [
          ['Continuous internal assessments conducted as per (TADP) in accordance with ATO.', 6],
          ['Maintain Continuous Assessment grades in Grade Books', 6],
          ['Continuous internal assessments scripts marked/graded/recorded within five (5) working days of given assessments.', 6],
          ['Request for Assessments submitted to ATO within three (3) days of internal assessment.', 8]
        ] }
      ]
    }
  };

  /* Payment Reward Table (verbatim): individual score 80..100 -> % of basic pay. */
  function sappPayReward(scoreRounded) {
    if (scoreRounded < 80) return null;
    var s = Math.min(100, Math.round(scoreRounded));
    return Math.round((4.0 + (s - 80) * 0.1) * 10) / 10;
  }

  function sappCategory(pct) {
    if (pct >= 90) return 'Outstanding';
    if (pct >= 80) return 'Commendable';
    if (pct >= 60) return 'Meets Job Requirements';
    return 'Unsatisfactory';
  }

  function sappClamp(n, lo, hi) {
    n = Number(n);
    if (isNaN(n)) return null;
    return Math.max(lo, Math.min(hi, n));
  }

  /* --------------------------------------------------------------------------
     Core calculation. `appraisal` holds raw entered scores:
       s1: { "<obj>_<ind>": number }   (0..indicator weight)
       s2: { "<factor>_<bullet>": 1..5 }
       s3: { "<factor>_<bullet>": 1..5 }   (supervisory templates only)
     Returns every derived figure the instrument asks for. Average score per
     factor = factor total ÷ number of criteria (per the instrument's N.B.).
     -------------------------------------------------------------------------- */
  function sappCalc(appraisal) {
    var tpl = SAPP_TEMPLATES[appraisal.template];
    if (!tpl) return null;
    var out = { template: appraisal.template, supervisory: !!tpl.supervisory };

    var s1 = appraisal.s1 || {};
    var s1Total = 0, s1Entered = 0, s1Count = 0;
    var s1Rows = [];
    tpl.section1.forEach(function (obj, oi) {
      obj.indicators.forEach(function (ind, ii) {
        s1Count++;
        var raw = s1[oi + '_' + ii];
        var v = (raw === '' || raw === undefined || raw === null) ? null : sappClamp(raw, 0, ind[1]);
        if (v !== null) { s1Total += v; s1Entered++; }
        s1Rows.push({ oi: oi, ii: ii, weight: ind[1], score: v });
      });
    });
    out.s1Total = Math.round(s1Total * 100) / 100;
    out.s1Complete = s1Entered === s1Count;
    out.s1Rows = s1Rows;

    function factorSet(defs, scores) {
      var res = { factors: [], total: 0, complete: true };
      defs.forEach(function (f, fi) {
        var tot = 0, entered = 0;
        f.bullets.forEach(function (_, bi) {
          var raw = scores[fi + '_' + bi];
          var v = (raw === '' || raw === undefined || raw === null) ? null : sappClamp(Math.round(raw), 1, 5);
          if (v !== null) { tot += v; entered++; }
        });
        var complete = entered === f.bullets.length;
        if (!complete) res.complete = false;
        res.factors.push({
          name: f.name, max: f.max, total: tot, entered: entered,
          avg: entered ? Math.round((tot / f.bullets.length) * 100) / 100 : null
        });
        res.total += tot;
      });
      return res;
    }

    var s2 = factorSet(SAPP_SECTION2, appraisal.s2 || {});
    out.s2 = s2.factors; out.s2Total = s2.total; out.s2Complete = s2.complete;

    if (tpl.supervisory) {
      var s3 = factorSet(SAPP_SECTION3, appraisal.s3 || {});
      out.s3 = s3.factors; out.s3Total = s3.total; out.s3Complete = s3.complete;
    } else {
      out.s3 = null; out.s3Total = 0; out.s3Complete = true;
    }

    out.divisor = tpl.supervisory ? 385 : 280;
    out.grandTotal = Math.round((out.s1Total + out.s2Total + out.s3Total) * 100) / 100;
    out.finalPctExact = Math.round((out.grandTotal * 100 / out.divisor) * 100) / 100;
    out.finalPct = Math.round(out.grandTotal * 100 / out.divisor);
    out.category = sappCategory(out.finalPct);
    out.payPct = sappPayReward(out.finalPct);
    out.complete = out.s1Complete && out.s2Complete && out.s3Complete;
    return out;
  }

  /* --------------------------------------------------------------------------
     Appraisal cycle helpers. A cycle runs 1 April (startYear) – 31 March
     (startYear+1). The appraisal window for a cycle opens 1 March of its
     closing year and the appraisal is DUE by 30 April after the cycle ends.
     -------------------------------------------------------------------------- */
  function sappCycleFor(date) {
    var d = date instanceof Date ? date : new Date(date);
    var y = d.getFullYear(), m = d.getMonth(); // 0-based; April = 3
    var startYear = m >= 3 ? y : y - 1;
    return sappCycleFromStartYear(startYear);
  }
  function sappCycleFromStartYear(startYear) {
    return {
      key: startYear + '-' + (startYear + 1),
      startYear: startYear,
      label: 'April ' + startYear + ' – March ' + (startYear + 1),
      windowOpen: new Date(startYear + 1, 2, 1),   // 1 March of closing year
      dueDate: new Date(startYear + 1, 3, 30, 23, 59, 59) // 30 April after cycle end
    };
  }
  /* The cycle whose appraisal the Administrator should currently be working
     on: once a cycle's window is open it stays "current" until the next
     cycle's window opens (i.e. from 1 Mar of closing year to 28/29 Feb of the
     following year). */
  function sappDueCycle(now) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var c = sappCycleFor(d);
    // Window for the running cycle opens 1 March of its closing year; before
    // that, the previous cycle is the one being appraised.
    return (d >= c.windowOpen) ? c : sappCycleFromStartYear(c.startYear - 1);
  }
  function sappDueStatus(now) {
    var d = now instanceof Date ? now : new Date(now || Date.now());
    var cyc = sappDueCycle(d);
    return {
      cycle: cyc,
      open: d >= cyc.windowOpen,
      overdue: d > cyc.dueDate,
      dueLabel: '30 April ' + (cyc.startYear + 1)
    };
  }

  /* --------------------------------------------------------------------------
     Full-name helpers. Every user/staff account must carry a FULL name (first
     name AND last name) so appraisals can be linked to Staff Payslip employee
     records, where matching is done on first + last name.
     -------------------------------------------------------------------------- */
  var SAPP_TITLES = { mr: 1, mrs: 1, ms: 1, miss: 1, dr: 1, prof: 1, hon: 1, rev: 1 };
  function sappNameTokens(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/[-_.,'’]/g, ' ')
      .split(/\s+/)
      .filter(function (t) { return t && !SAPP_TITLES[t]; });
  }
  /* True when the name holds at least a first name and a last name
     (two or more real word tokens of 2+ letters, titles ignored). */
  function sappIsFullName(name) {
    var toks = sappNameTokens(name).filter(function (t) { return t.length >= 2; });
    return toks.length >= 2;
  }
  /* Match a staff name against a list of payslip employee names.
     Names are matched by FIRST NAME and LAST NAME (both must agree,
     case/punctuation-insensitive). Returns the matched employee name or null.
     A staff member without a full first+last name can never match. */
  function sappMatchPayslipName(staffName, employeeNames) {
    if (!sappIsFullName(staffName)) return null;
    var s = sappNameTokens(staffName);
    var sFirst = s[0], sLast = s[s.length - 1];
    var hit = null;
    (employeeNames || []).forEach(function (en) {
      if (hit) return;
      var e = sappNameTokens(en);
      if (e.length < 2) return;
      if (e[0] === sFirst && e[e.length - 1] === sLast) hit = en;
    });
    return hit;
  }

  /* --------------------------------------------------------------------------
     Signature status. Every completed instrument carries three signature
     parties: the Appraisee (staff member), the Appraiser
     (Coordinator/Administrator) and the CMC Chair. A party has signed when a
     signature record with data exists ({type:'typed'|'drawn'|'upload',
     data, name, date, agree?, comment?}).
     -------------------------------------------------------------------------- */
  function sappSignatureStatus(a) {
    var s = (a && a.signatures) || {};
    function has(r) { return !!(s[r] && s[r].data); }
    var st = { appraisee: has('appraisee'), appraiser: has('appraiser'), cmc: has('cmc') };
    st.fullySigned = st.appraisee && st.appraiser && st.cmc;
    return st;
  }
  /* Same-person check used to decide whose appraisal a logged-in staff member
     may view and sign: first and last name must agree. */
  function sappSamePerson(nameA, nameB) {
    var a = sappNameTokens(nameA), b = sappNameTokens(nameB);
    if (a.length < 2 || b.length < 2) return false;
    return a[0] === b[0] && a[a.length - 1] === b[b.length - 1];
  }

  /* --------------------------------------------------------------------------
     Cloud sync merge. Appraisals are edited on more than one device — the
     Administrator completes the instrument on theirs, the staff member signs on
     theirs and the CMC Chair on a third — so a cloud round-trip must never let
     one device's copy overwrite another's signature. Rules:
       - an appraisal present on only one side is kept
       - when both sides have it, the newer `updatedAt` wins for the scores,
         but signatures are UNIONED across both copies (each of the three
         parties owns a different signature slot)
       - when both sides hold the same signature slot, the later `signedAt` wins
       - assignments / extraStaff / flags are unioned
     Pure and order-independent, so it can be unit tested.
     -------------------------------------------------------------------------- */
  function sappTime(v) {
    var t = Date.parse(v || '');
    return isNaN(t) ? 0 : t;
  }
  function sappMergeSignatures(a, b) {
    var out = {};
    ['appraisee', 'appraiser', 'cmc'].forEach(function (role) {
      var x = a && a[role], y = b && b[role];
      if (x && x.data && y && y.data) out[role] = sappTime(y.signedAt) > sappTime(x.signedAt) ? y : x;
      else if (x && x.data) out[role] = x;
      else if (y && y.data) out[role] = y;
    });
    return out;
  }
  function sappMergeAppraisal(local, remote) {
    if (!local) return remote;
    if (!remote) return local;
    var base = sappTime(remote.updatedAt) > sappTime(local.updatedAt) ? remote : local;
    var merged = {};
    Object.keys(base).forEach(function (k) { merged[k] = base[k]; });
    merged.signatures = sappMergeSignatures(local.signatures, remote.signatures);
    // A completed appraisal never reverts to draft just because the other
    // device still held the older draft.
    if (local.status === 'completed' || remote.status === 'completed') merged.status = 'completed';
    return merged;
  }
  function sappMergeData(local, remote) {
    var L = local && typeof local === 'object' ? local : {};
    var R = remote && typeof remote === 'object' ? remote : {};
    var out = {
      cycles: {},
      assignments: Object.assign({}, L.assignments || {}, R.assignments || {}),
      extraStaff: (L.extraStaff || []).slice(),
      flags: Object.assign({}, L.flags || {}, R.flags || {})
    };
    var lc = L.cycles || {}, rc = R.cycles || {};
    Object.keys(lc).concat(Object.keys(rc)).forEach(function (ck) {
      if (out.cycles[ck]) return;
      out.cycles[ck] = {};
      var lcy = lc[ck] || {}, rcy = rc[ck] || {};
      Object.keys(lcy).concat(Object.keys(rcy)).forEach(function (sid) {
        if (out.cycles[ck][sid]) return;
        out.cycles[ck][sid] = sappMergeAppraisal(lcy[sid], rcy[sid]);
      });
    });
    var seenExtra = {};
    out.extraStaff.forEach(function (s) { if (s && s.id) seenExtra[s.id] = true; });
    (R.extraStaff || []).forEach(function (s) {
      if (s && s.id && !seenExtra[s.id]) { seenExtra[s.id] = true; out.extraStaff.push(s); }
    });
    return out;
  }

  /* ==========================================================================
     Node export for unit tests (pure parts only).
     ========================================================================== */
  var api = {
    SAPP_TEMPLATES: SAPP_TEMPLATES,
    SAPP_SECTION2: SAPP_SECTION2,
    SAPP_SECTION3: SAPP_SECTION3,
    sappCalc: sappCalc,
    sappCategory: sappCategory,
    sappPayReward: sappPayReward,
    sappCycleFor: sappCycleFor,
    sappDueCycle: sappDueCycle,
    sappDueStatus: sappDueStatus,
    sappClamp: sappClamp,
    sappIsFullName: sappIsFullName,
    sappMatchPayslipName: sappMatchPayslipName,
    sappSignatureStatus: sappSignatureStatus,
    sappSamePerson: sappSamePerson,
    sappMergeData: sappMergeData,
    sappMergeAppraisal: sappMergeAppraisal,
    sappMergeSignatures: sappMergeSignatures
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) { root.sappIsFullName = sappIsFullName; root.sappMatchPayslipName = sappMatchPayslipName; }
  if (!root || typeof document === 'undefined') return; // Node: pure exports only.

  /* ==========================================================================
     BROWSER SIDE — storage, roster, page UI, preview/print, dashboards.
     ========================================================================== */
  var STORE_KEY = 'cestisStaffAppraisals';

  function store() { return root.CESTISStore || root.localStorage; }
  function sappData() {
    var raw = null;
    try { raw = store().getItem(STORE_KEY); } catch (e) {}
    var d = null;
    try { d = raw ? JSON.parse(raw) : null; } catch (e) { d = null; }
    if (!d || typeof d !== 'object') d = {};
    d.cycles = d.cycles || {};
    d.assignments = d.assignments || {};
    d.extraStaff = d.extraStaff || [];
    d.flags = d.flags || {};
    return d;
  }
  function sappPersist(d) {
    try { store().setItem(STORE_KEY, JSON.stringify(d)); } catch (e) { console.warn('[SAPP] save failed', e); }
    try { if (typeof root.sappUpdateNavBadge === 'function') root.sappUpdateNavBadge(); } catch (e) {}
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ----------------------- cloud sync bridge -----------------------
     index.html includes the result of sappCloudExport() in every Google Drive
     backup payload, and hands whatever it downloads to sappCloudImport(), so
     appraisals and signatures round-trip across devices like the rest of the
     LMS data. Returns null when there is nothing to save, so an empty local
     store can never blank the cloud copy. */
  root.sappCloudExport = function () {
    var d = sappData();
    var hasCycles = Object.keys(d.cycles || {}).some(function (ck) {
      return Object.keys(d.cycles[ck] || {}).length > 0;
    });
    if (!hasCycles && !Object.keys(d.assignments || {}).length && !(d.extraStaff || []).length) return null;
    return d;
  };
  root.sappCloudImport = function (remote) {
    if (!remote || typeof remote !== 'object') return false;
    try {
      var merged = sappMergeData(sappData(), remote);
      sappPersist(merged);
      return true;
    } catch (e) { console.warn('[SAPP] cloud import failed', e); return false; }
  };

  /* ----------------------- payslip employee linking ----------------------- */
  // Memoised for a second: sappPayslipLink() asks for this list once per staff
  // ROW rendered, and each ask was a read plus a JSON.parse of the entire
  // payroll store — every payroll run ever — repeated per row, per keystroke
  // in the roster search box.
  var _sappPayrollMemo = null, _sappPayrollAt = 0;
  function sappPayrollEmployees() {
    var now = Date.now();
    if (_sappPayrollMemo && (now - _sappPayrollAt) < 1000) return _sappPayrollMemo;
    try {
      var raw = store().getItem('cestisPayroll');
      var d = raw ? JSON.parse(raw) : null;
      _sappPayrollMemo = (d && Array.isArray(d.employees)) ? d.employees : [];
      _sappPayrollAt = now;
      return _sappPayrollMemo;
    } catch (e) { return []; }
  }
  /* Link a staff member to their Staff Payslip employee record, matched by
     first name + last name. Returns:
       { status:'nofullname' }                  — staff name has no first+last name
       { status:'linked', emp:{...} }           — matched payslip employee
       { status:'unmatched' }                   — full name, but no payslip match */
  function sappPayslipLink(staffName) {
    if (!sappIsFullName(staffName)) return { status: 'nofullname' };
    var emps = sappPayrollEmployees();
    var hit = sappMatchPayslipName(staffName, emps.map(function (e) { return e.name; }));
    if (!hit) return { status: 'unmatched' };
    var emp = emps.filter(function (e) { return e.name === hit; })[0];
    return { status: 'linked', emp: emp };
  }

  /* ----------------------- staff roster ----------------------- */
  function defaultTemplateForRole(role) {
    if (role === 'instructor') return 'instructor';
    if (role === 'adminstaff') return 'admin_assistant';
    if (role === 'admin') return 'coordinator';
    return 'admin_clerk';
  }
  /* Guess the appraisal instrument from a Staff Payslip designation. */
  function templateFromDesignation(desig) {
    var s = String(desig || '').toLowerCase();
    if (!s) return null;
    if (/assistant\s+(programme\s+)?co/.test(s)) return 'asst_coordinator';
    if (/programme\s+co|project\s+manager|co-?ordinator/.test(s)) return 'coordinator';
    if (/administrative\s+assistant|admin\.?\s+assistant/.test(s)) return 'admin_assistant';
    if (/clerk/.test(s)) return 'admin_clerk';
    if (/teacher|store\s*room/.test(s)) return 'teachers_assistant';
    if (/instructor|facilitator/.test(s)) return 'instructor';
    return null;
  }
  function sappRoster() {
    var d = sappData();
    var list = [], seen = {};
    function push(id, name, sourceRole, extra, tplGuess) {
      if (!name) return;
      // De-duplicate across sources by FIRST + LAST name (same rule used for
      // the Staff Payslip link), so "Rashaun Barrett" the user account and
      // "Rashaun Barrett" the payroll employee are one staff member.
      var toks = sappNameTokens(name).filter(function (t) { return t.length >= 2; });
      var key = toks.length >= 2 ? (toks[0] + '|' + toks[toks.length - 1]) : name.trim().toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      list.push({
        id: id, name: name.trim(), sourceRole: sourceRole,
        template: d.assignments[id] || tplGuess || defaultTemplateForRole(sourceRole),
        extra: !!extra
      });
    }
    var accounts = [];
    try { accounts = (root.userAccounts || []).slice(); } catch (e) {}
    if (!accounts.length) {
      try { accounts = JSON.parse(store().getItem('voctrain_userAccounts') || '[]'); } catch (e) {}
    }
    accounts.forEach(function (u) {
      if (!u || u.status === 'inactive') return;
      if (u.role === 'instructor' || u.role === 'adminstaff' || u.role === 'admin') {
        push('USR:' + u.id, u.name, u.role);
      }
    });
    // Staff Clock-in roster (sibling app, same store).
    var clock = [];
    try { clock = JSON.parse(store().getItem('cestisStaffMembers') || '[]'); } catch (e) {}
    (clock || []).forEach(function (s) {
      if (!s) return;
      push('CLK:' + (s.username || s.fullName), s.fullName || s.name, 'clockin');
    });
    // Staff Payslip employees (Staff.Payslip.html) — every staff member on the
    // payroll must appear on the appraisal roster, matched by first+last name.
    sappPayrollEmployees().forEach(function (e) {
      if (!e || !e.name) return;
      push('PAY:' + e.name, e.name, 'payslip', false, templateFromDesignation(e.designation));
    });
    (d.extraStaff || []).forEach(function (s) {
      push('EXT:' + s.id, s.name, s.role || 'extra', true);
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return list;
  }

  function sappGetAppraisal(cycleKey, staffId) {
    var d = sappData();
    return (d.cycles[cycleKey] || {})[staffId] || null;
  }
  function sappSaveAppraisal(app) {
    var d = sappData();
    if (!d.cycles[app.cycle]) d.cycles[app.cycle] = {};
    app.updatedAt = new Date().toISOString();
    d.cycles[app.cycle][app.staffId] = app;
    d.assignments[app.staffId] = app.template;
    sappPersist(d);
  }

  /* ----------------------- due / notification logic ----------------------- */
  function sappDueSummary(now) {
    var st = sappDueStatus(now || new Date());
    var roster = sappRoster();
    var d = sappData();
    var cyc = d.cycles[st.cycle.key] || {};
    var done = [], pending = [];
    roster.forEach(function (s) {
      var a = cyc[s.id];
      if (a && a.status === 'completed') done.push(s); else pending.push({ staff: s, draft: !!a });
    });
    return { status: st, roster: roster, done: done, pending: pending };
  }

  root.sappUpdateNavBadge = function () {
    var el = document.getElementById('sappNavBadge');
    if (!el) return;
    try {
      var sum = sappDueSummary();
      var n = sum.pending.length;
      if (sum.status.open && n > 0) {
        el.textContent = n;
        el.style.display = '';
        el.style.background = sum.status.overdue ? 'var(--red)' : 'var(--accent)';
      } else el.style.display = 'none';
    } catch (e) {}
  };

  /* Called from enterApp() when the Administrator signs in. Raises a bell
     notification once per cycle when the window opens, and once more if the
     due date passes with appraisals still outstanding. */
  root.sappOnAdminLogin = function () {
    try {
      var sum = sappDueSummary();
      if (!sum.status.open) return;
      var d = sappData();
      var flagOpen = 'notified_open_' + sum.status.cycle.key;
      var flagOver = 'notified_overdue_' + sum.status.cycle.key;
      if (sum.pending.length > 0 && !d.flags[flagOpen]) {
        d.flags[flagOpen] = true; sappPersist(d);
        if (typeof root.addNotification === 'function') {
          root.addNotification('Staff appraisals for ' + sum.status.cycle.label + ' are due by ' + sum.status.dueLabel + ' — ' + sum.pending.length + ' of ' + sum.roster.length + ' staff not yet appraised.', 'warning', '📋', ['admin']);
        }
      }
      if (sum.status.overdue && sum.pending.length > 0 && !d.flags[flagOver]) {
        d.flags[flagOver] = true; sappPersist(d);
        if (typeof root.addNotification === 'function') {
          root.addNotification('OVERDUE: ' + sum.pending.length + ' staff appraisal' + (sum.pending.length === 1 ? '' : 's') + ' for ' + sum.status.cycle.label + ' still incomplete (was due ' + sum.status.dueLabel + ').', 'warning', '⚠️', ['admin']);
        }
      }
      root.sappUpdateNavBadge();
      root.sappRenderAdminDueCard();
    } catch (e) { console.warn('[SAPP] admin login check failed', e); }
  };

  /* Admin dashboard card: appraisal season status + who is outstanding. */
  root.sappRenderAdminDueCard = function () {
    var el = document.getElementById('sappAdminDueCard');
    if (!el) return;
    var sum;
    try { sum = sappDueSummary(); } catch (e) { el.innerHTML = ''; return; }
    if (!sum.status.open || sum.roster.length === 0) { el.innerHTML = ''; return; }
    var n = sum.pending.length, tot = sum.roster.length;
    var color = n === 0 ? 'var(--green)' : (sum.status.overdue ? 'var(--red)' : 'var(--accent)');
    var title = n === 0
      ? 'All staff appraisals completed for ' + sum.status.cycle.label
      : (sum.status.overdue ? 'Staff appraisals OVERDUE — ' : 'Staff appraisals due — ') + n + ' of ' + tot + ' outstanding';
    var names = sum.pending.slice(0, 6).map(function (p) { return esc(p.staff.name) + (p.draft ? ' (in progress)' : ''); }).join(', ');
    if (sum.pending.length > 6) names += ' +' + (sum.pending.length - 6) + ' more';
    el.innerHTML =
      '<div class="card" style="margin-bottom:24px;border-left:4px solid ' + color + ';cursor:pointer;" onclick="showPage(\'staff-appraisals\')">' +
        '<div style="display:flex;align-items:center;gap:14px;padding:4px 0;">' +
          '<div style="font-size:28px;">📋</div>' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-weight:700;color:' + color + ';">' + title + '</div>' +
            '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">Appraisal period ' + esc(sum.status.cycle.label) + ' • due by ' + esc(sum.status.dueLabel) +
            (n ? ' • Outstanding: ' + names : '') + '</div>' +
          '</div>' +
          '<div style="font-size:12px;color:var(--accent);white-space:nowrap;">Open Appraisals →</div>' +
        '</div>' +
      '</div>';
  };

  /* Staff dashboard card ("grades show on each staff dashboard"). */
  root.sappRenderMyCard = function (elId) {
    var el = document.getElementById(elId);
    if (!el) return;
    var me = null;
    try { me = root.currentLoggedInUser || null; } catch (e) {}
    var myName = me && me.name ? me.name : (root.currentInstructor && root.currentInstructor.name) || null;
    if (!myName) { el.innerHTML = ''; return; }
    var d = sappData();
    var latest = null;
    Object.keys(d.cycles).sort().forEach(function (ck) {
      Object.keys(d.cycles[ck]).forEach(function (sid) {
        var a = d.cycles[ck][sid];
        if (a && a.status === 'completed' && a.staffName && a.staffName.trim().toLowerCase() === myName.trim().toLowerCase()) latest = a;
      });
    });
    if (!latest) { el.innerHTML = ''; return; }
    var calc = sappCalc(latest);
    if (!calc) { el.innerHTML = ''; return; }
    var color = calc.finalPct >= 90 ? 'var(--green)' : calc.finalPct >= 80 ? 'var(--accent)' : calc.finalPct >= 60 ? 'var(--orange)' : 'var(--red)';
    var signPage = elId.indexOf('as') === 0 ? 'as-my-appraisal' : 'i-my-appraisal';
    var sigSt = sappSignatureStatus(latest);
    var signHint = sigSt.appraisee
      ? '<span style="font-size:12px;color:var(--green);">✓ Signed by you</span>'
      : '<button class="btn btn-primary btn-sm" onclick="showPage(\'' + signPage + '\')">🖋 View & Sign Appraisal</button>';
    el.innerHTML =
      '<div class="card" style="margin-bottom:24px;padding:20px;">' +
        '<div class="card-header" style="margin-bottom:12px;"><h3>My Performance Appraisal</h3><span style="display:flex;gap:10px;align-items:center;"><span style="font-size:12px;color:var(--text-muted);">' + esc(latest.period || latest.cycle) + '</span>' + signHint + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap;">' +
          '<div style="text-align:center;"><div style="font-size:40px;font-weight:800;color:' + color + ';">' + calc.finalPct + '%</div>' +
          '<div style="font-size:12px;color:var(--text-muted);">Final Score</div></div>' +
          '<div style="flex:1;min-width:220px;">' +
            '<div style="font-weight:700;margin-bottom:6px;color:' + color + ';">' + esc(calc.category) + '</div>' +
            '<div style="height:10px;border-radius:6px;background:var(--bg-card-hover,rgba(127,127,127,.15));overflow:hidden;margin-bottom:8px;"><div style="height:100%;width:' + Math.min(100, calc.finalPct) + '%;background:' + color + ';"></div></div>' +
            '<div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);flex-wrap:wrap;">' +
              '<span>Section 1: <strong>' + calc.s1Total + '</strong>/100</span>' +
              '<span>Section 2: <strong>' + calc.s2Total + '</strong>/180</span>' +
              (calc.supervisory ? '<span>Section 3: <strong>' + calc.s3Total + '</strong>/105</span>' : '') +
              (calc.payPct != null ? '<span>Reward: <strong>' + calc.payPct + '% of basic pay</strong></span>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  };

  /* ==========================================================================
     ADMIN PAGE UI (mounted into Pages/Staff-Appraisals.html slots)
     ========================================================================== */
  var sappState = { cycleKey: null, editing: null };

  root.sappOnPageShow = function () {
    var host = document.getElementById('sappPageRoot');
    if (!host) return;
    var role = null;
    try { role = root.currentRole; } catch (e) {}
    if (role !== 'admin') {
      host.innerHTML = '<div class="card" style="padding:40px;text-align:center;color:var(--text-muted);">' +
        '<div style="font-size:40px;margin-bottom:12px;">🔒</div>' +
        '<h3>Administrator access only</h3><p>Staff performance appraisals can only be viewed and graded by the Administrator.</p></div>';
      return;
    }
    if (!sappState.cycleKey) sappState.cycleKey = sappDueCycle(new Date()).key;
    sappRenderPage();
  };

  function sappCycleOptions() {
    var cur = sappDueCycle(new Date());
    var d = sappData();
    var keys = {};
    keys[cur.key] = true;
    keys[sappCycleFromStartYear(cur.startYear + 1).key] = true;
    for (var i = 1; i <= 3; i++) keys[sappCycleFromStartYear(cur.startYear - i).key] = true;
    Object.keys(d.cycles).forEach(function (k) { keys[k] = true; });
    return Object.keys(keys).sort().reverse();
  }

  function sappRenderPage() {
    var host = document.getElementById('sappPageRoot');
    if (!host) return;
    if (sappState.editing) { sappRenderEditor(host); return; }

    var sum = sappDueSummary();
    var cycle = sappCycleFromStartYear(parseInt(sappState.cycleKey.split('-')[0], 10));
    var d = sappData();
    var cycData = d.cycles[cycle.key] || {};
    var roster = sappRoster();

    var html = '';
    // Due banner (always reflects the CURRENT due cycle, independent of the viewed cycle)
    var n = sum.pending.length, tot = sum.roster.length;
    var bColor = n === 0 ? 'var(--green)' : (sum.status.overdue ? 'var(--red)' : 'var(--accent)');
    html += '<div class="card" style="margin-bottom:20px;border-left:4px solid ' + bColor + ';">' +
      '<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;">' +
      '<div style="font-size:26px;">📅</div><div style="flex:1;min-width:220px;">' +
      '<div style="font-weight:700;color:' + bColor + ';">' +
      (n === 0 ? 'All appraisals completed for ' + esc(sum.status.cycle.label)
               : (sum.status.overdue ? 'OVERDUE: ' : 'Appraisals due: ') + n + ' of ' + tot + ' staff not yet appraised for ' + esc(sum.status.cycle.label)) +
      '</div>' +
      '<div style="font-size:12px;color:var(--text-muted);">Annual appraisal window opens 1 March and is due by ' + esc(sum.status.dueLabel) + '. The Administrator is notified each year when appraisals fall due.</div>' +
      '</div></div></div>';

    // Staff whose account name is not a FULL name (first + last) cannot be
    // linked to their Staff Payslip employee record — flag them to the admin.
    var noFull = roster.filter(function (s) { return !sappIsFullName(s.name); });
    if (noFull.length) {
      html += '<div class="card" style="margin-bottom:20px;border-left:4px solid var(--orange);">' +
        '<div style="display:flex;align-items:flex-start;gap:14px;">' +
        '<div style="font-size:24px;">⚠️</div><div style="flex:1;">' +
        '<div style="font-weight:700;color:var(--orange);">' + noFull.length + ' staff member' + (noFull.length === 1 ? '' : 's') + ' without a first AND last name: ' +
        noFull.map(function (s) { return esc(s.name); }).join(', ') + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:2px;">All users must enter their full name (first name and last name) on their account. ' +
        'Without it the appraisal cannot be linked to the Staff Payslip employee record (names are matched by first and last name). ' +
        'Update the name in Settings → User Accounts.</div>' +
        '</div></div></div>';
    }

    // Toolbar
    html += '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px;">' +
      '<label style="font-size:13px;color:var(--text-muted);">Appraisal period:</label>' +
      '<select class="form-control" style="width:220px;" onchange="sappSetCycle(this.value)">' +
      sappCycleOptions().map(function (k) {
        var c = sappCycleFromStartYear(parseInt(k.split('-')[0], 10));
        return '<option value="' + k + '"' + (k === cycle.key ? ' selected' : '') + '>' + esc(c.label) + '</option>';
      }).join('') +
      '</select>' +
      '<input type="text" id="sappSearch" class="form-control" style="width:240px;" placeholder="Search staff..." onkeyup="sappRenderRosterDebounced()">' +
      '<button class="btn btn-secondary" onclick="sappAddStaffPrompt()">+ Add Staff Member</button>' +
      '</div>';

    html += '<div id="sappRosterWrap"></div>';
    host.innerHTML = html;
    sappRenderRoster();
  }

  root.sappSetCycle = function (k) { sappState.cycleKey = k; sappRenderPage(); };

  // The search box rebuilds the whole roster table (with a storage parse per
  // row before the memo above); firing it on every keystroke made typing lag.
  var _sappSearchTimer = null;
  root.sappRenderRosterDebounced = function () {
    if (_sappSearchTimer) clearTimeout(_sappSearchTimer);
    _sappSearchTimer = setTimeout(function () {
      _sappSearchTimer = null;
      root.sappRenderRoster();
    }, 150);
  };

  root.sappRenderRoster = function () {
    var wrap = document.getElementById('sappRosterWrap');
    if (!wrap) return;
    var cycleKey = sappState.cycleKey;
    var d = sappData();
    var cyc = d.cycles[cycleKey] || {};
    var q = (document.getElementById('sappSearch') || {}).value || '';
    q = q.trim().toLowerCase();
    var roster = sappRoster().filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; });

    var rows = roster.map(function (s) {
      var a = cyc[s.id];
      var tplKey = a ? a.template : s.template;
      var tpl = SAPP_TEMPLATES[tplKey] || SAPP_TEMPLATES.instructor;
      var calc = a ? sappCalc(a) : null;
      var status, sColor;
      if (a && a.status === 'completed') { status = 'Completed'; sColor = 'var(--green)'; }
      else if (a) { status = 'In progress'; sColor = 'var(--accent)'; }
      else { status = 'Not started'; sColor = 'var(--text-muted)'; }
      var score = (a && a.status === 'completed' && calc) ? ('<strong style="color:' + (calc.finalPct >= 80 ? 'var(--green)' : calc.finalPct >= 60 ? 'var(--orange)' : 'var(--red)') + ';">' + calc.finalPct + '%</strong> <span style="font-size:11px;color:var(--text-muted);">' + esc(calc.category) + '</span>') : '<span style="color:var(--text-muted);">—</span>';
      var tplSelect = '<select class="form-control" style="width:100%;max-width:260px;font-size:12px;"' + (a ? ' disabled title="Template locked once grading has started (delete the appraisal to change it)"' : '') + ' onchange="sappAssignTemplate(\'' + esc(s.id) + '\', this.value)">' +
        Object.keys(SAPP_TEMPLATES).map(function (k) {
          return '<option value="' + k + '"' + (k === tplKey ? ' selected' : '') + '>' + esc(SAPP_TEMPLATES[k].label) + '</option>';
        }).join('') + '</select>';
      var link = sappPayslipLink(s.name);
      var linkCell;
      if (link.status === 'linked') {
        linkCell = '<span style="color:var(--green);font-weight:600;" title="Matched by first and last name to Staff Payslip employee &quot;' + esc(link.emp.name) + '&quot;">✓ Linked</span>' +
          (link.emp.designation ? '<div style="font-size:11px;color:var(--text-muted);">' + esc(link.emp.designation) + '</div>' : '');
      } else if (link.status === 'nofullname') {
        linkCell = '<span style="color:var(--orange);font-weight:600;" title="Account name must contain a first name and a last name before it can be matched to a Payslip employee">⚠ No full name</span>';
      } else {
        linkCell = '<span style="color:var(--text-muted);" title="No Staff Payslip employee with the same first and last name">Not in Payslip</span>';
      }
      var nameWarn = sappIsFullName(s.name) ? '' : ' <span title="No first and last name on this account" style="color:var(--orange);">⚠</span>';
      return '<tr>' +
        '<td><div style="font-weight:600;">' + esc(s.name) + nameWarn + '</div><div style="font-size:11px;color:var(--text-muted);">' + esc(sappRoleLabel(s.sourceRole)) + '</div></td>' +
        '<td>' + tplSelect + '</td>' +
        '<td>' + linkCell + '</td>' +
        '<td><span style="color:' + sColor + ';font-weight:600;">' + status + '</span></td>' +
        '<td>' + score + '</td>' +
        '<td style="white-space:nowrap;">' +
          '<button class="btn btn-primary btn-sm" onclick="sappOpenEditor(\'' + esc(s.id) + '\')">' + (a ? 'Open' : 'Grade') + '</button> ' +
          '<button class="btn btn-secondary btn-sm" onclick="sappOpenPreview(\'' + esc(s.id) + '\')">Preview</button> ' +
          '<button class="btn btn-secondary btn-sm" onclick="sappPrint(\'' + esc(s.id) + '\')">Print PDF</button>' +
          (a ? ' <button class="btn btn-danger btn-sm" onclick="sappDeleteAppraisal(\'' + esc(s.id) + '\')">✕</button>' : '') +
          (s.extra ? ' <button class="btn btn-danger btn-sm" title="Remove staff member" onclick="sappRemoveExtraStaff(\'' + esc(s.id) + '\')">Remove</button>' : '') +
        '</td>' +
      '</tr>';
    }).join('');

    wrap.innerHTML = '<div class="card"><div class="card-header"><h3>Staff Appraisals — ' +
      esc(sappCycleFromStartYear(parseInt(cycleKey.split('-')[0], 10)).label) + '</h3>' +
      '<span style="font-size:12px;color:var(--text-muted);">' + roster.length + ' staff</span></div>' +
      '<div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Staff Member</th><th>Appraisal Instrument (Position)</th><th>Payslip Link</th><th>Status</th><th>Final Score</th><th>Actions</th></tr></thead>' +
      '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:24px;">No staff found. Staff appear here from User Accounts (Instructors, Admin Staff, Administrators) and the Staff Clock-in register, or add one manually.</td></tr>') + '</tbody>' +
      '</table></div></div>';
  };

  function sappRoleLabel(r) {
    return r === 'instructor' ? 'Instructor account' :
           r === 'adminstaff' ? 'Admin staff account' :
           r === 'admin' ? 'Administrator account' :
           r === 'clockin' ? 'Staff clock-in register' :
           r === 'payslip' ? 'Staff Payslip employee' : 'Added manually';
  }

  root.sappAssignTemplate = function (staffId, tplKey) {
    var d = sappData();
    d.assignments[staffId] = tplKey;
    sappPersist(d);
    sappRenderRoster();
  };

  root.sappAddStaffPrompt = function () {
    var name = prompt('Staff member’s FULL name (first name and last name, e.g. "Rashaun Barrett"):');
    if (!name || !name.trim()) return;
    if (!sappIsFullName(name)) {
      alert('Please enter both a first name and a last name. The full name is required to link the appraisal to the Staff Payslip employee record.');
      return;
    }
    var d = sappData();
    d.extraStaff.push({ id: 'X' + Date.now(), name: name.trim(), role: 'extra' });
    sappPersist(d);
    sappRenderRoster();
  };
  root.sappRemoveExtraStaff = function (staffId) {
    if (!confirm('Remove this staff member from the appraisal roster?')) return;
    var d = sappData();
    d.extraStaff = d.extraStaff.filter(function (s) { return ('EXT:' + s.id) !== staffId; });
    sappPersist(d);
    sappRenderRoster();
  };
  root.sappDeleteAppraisal = function (staffId) {
    if (!confirm('Delete this appraisal (all entered scores for this staff member and period)? This cannot be undone.')) return;
    var d = sappData();
    if (d.cycles[sappState.cycleKey]) delete d.cycles[sappState.cycleKey][staffId];
    sappPersist(d);
    sappRenderRoster();
  };

  function sappNewAppraisal(staff, cycleKey) {
    var cyc = sappCycleFromStartYear(parseInt(cycleKey.split('-')[0], 10));
    var tplKey = staff.template;
    return {
      cycle: cycleKey,
      staffId: staff.id,
      staffName: staff.name,
      template: tplKey,
      period: cyc.label,
      appraiser: '',
      skillArea: '',
      lengthSupervising: '',
      typeOfAppraisal: 'Annual',
      s1: {}, s2: {}, s3: {},
      comments: {},
      status: 'draft',
      createdAt: new Date().toISOString()
    };
  }

  /* ----------------------- editor ----------------------- */
  root.sappOpenEditor = function (staffId) {
    var staff = sappRoster().filter(function (s) { return s.id === staffId; })[0];
    if (!staff) return;
    var a = sappGetAppraisal(sappState.cycleKey, staffId) || sappNewAppraisal(staff, sappState.cycleKey);
    sappState.editing = a;
    sappRenderPage();
  };
  root.sappCloseEditor = function () { sappState.editing = null; sappRenderPage(); };

  function numInput(id, val, min, max, step, width) {
    return '<input type="number" id="' + id + '" value="' + (val === null || val === undefined ? '' : val) + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '" style="width:' + (width || 64) + 'px;text-align:center;" class="form-control sapp-score" oninput="sappOnScoreInput()">';
  }

  function sappRenderEditor(host) {
    var a = sappState.editing;
    var tpl = SAPP_TEMPLATES[a.template];
    var html = '';
    html += '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:16px;">' +
      '<button class="btn btn-secondary" onclick="sappCloseEditor()">← Back to roster</button>' +
      '<h3 style="margin:0;flex:1;">Grading: ' + esc(a.staffName) + ' — ' + esc(tpl.label) + '</h3>' +
      '<button class="btn btn-secondary" onclick="sappOpenPreview(\'' + esc(a.staffId) + '\')">Live Preview</button>' +
      '<button class="btn btn-secondary" onclick="sappPrint(\'' + esc(a.staffId) + '\')">Print PDF</button>' +
      '<button class="btn btn-primary" onclick="sappSaveDraft()">Save</button>' +
      '<button class="btn btn-primary" id="sappCompleteBtn" onclick="sappMarkCompleted()">Mark Completed</button>' +
      '</div>';

    var eLink = sappPayslipLink(a.staffName);
    var eLinkHtml = eLink.status === 'linked'
      ? '<span style="color:var(--green);font-weight:600;">✓ Linked to Staff Payslip employee “' + esc(eLink.emp.name) + '”' + (eLink.emp.designation ? ' — ' + esc(eLink.emp.designation) : '') + '</span>'
      : eLink.status === 'nofullname'
        ? '<span style="color:var(--orange);font-weight:600;">⚠ This staff account has no first and last name — it cannot be linked to a Staff Payslip employee. Update the account name (full name is now required for all users).</span>'
        : '<span style="color:var(--text-muted);">No Staff Payslip employee matches this first and last name.</span>';
    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3>Appraisal Details</h3></div>' +
      '<div style="font-size:12px;margin-bottom:10px;">' + eLinkHtml + '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;">' +
      '<div class="form-group"><label>Appraisal Period</label><input class="form-control" id="sappFPeriod" value="' + esc(a.period) + '"></div>' +
      '<div class="form-group"><label>Appraiser (Name)</label><input class="form-control" id="sappFAppraiser" value="' + esc(a.appraiser) + '" placeholder="e.g. Mr. Jason Hall"></div>' +
      '<div class="form-group"><label>Length of time supervising</label><input class="form-control" id="sappFSupervising" value="' + esc(a.lengthSupervising) + '"></div>' +
      (tpl.hasSkillArea ? '<div class="form-group"><label>Skill Area</label><input class="form-control" id="sappFSkill" value="' + esc(a.skillArea) + '" placeholder="e.g. Beauty Therapy Level 2"></div>' : '') +
      '<div class="form-group"><label>Type of Appraisal</label><select class="form-control" id="sappFType">' +
        ['Annual', 'Probationary', 'Special'].map(function (t) { return '<option' + (a.typeOfAppraisal === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select></div>' +
      '</div></div>';

    // Section 1
    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3>Section 1: Quantitative Performance Objectives</h3><span id="sappS1Tot" style="font-weight:700;"></span></div>' +
      '<div style="overflow-x:auto;"><table class="data-table sapp-edit-table" style="width:100%;"><thead><tr><th style="min-width:150px;">Objective</th><th>Performance Indicator</th><th style="width:70px;">Weight</th><th style="width:90px;">Actual</th><th style="min-width:160px;">Comments</th></tr></thead><tbody>';
    tpl.section1.forEach(function (obj, oi) {
      obj.indicators.forEach(function (ind, ii) {
        var key = oi + '_' + ii;
        html += '<tr>' +
          (ii === 0 ? '<td rowspan="' + obj.indicators.length + '" style="vertical-align:top;"><strong>' + esc(obj.name) + '</strong><br><span style="font-size:11px;color:var(--text-muted);">Weight: ' + obj.weight + '</span></td>' : '') +
          '<td style="font-size:12px;">' + esc(ind[0]) + '</td>' +
          '<td style="text-align:center;">' + ind[1] + '</td>' +
          '<td>' + numInput('sapp_s1_' + key, (a.s1 || {})[key], 0, ind[1], 0.5) + '</td>' +
          '<td><input class="form-control" style="font-size:12px;" id="sapp_c1_' + key + '" value="' + esc((a.comments || {})['s1_' + key] || '') + '"></td>' +
          '</tr>';
      });
    });
    html += '</tbody></table></div></div>';

    // Section 2
    html += sappFactorEditor('Section 2: Key Job Performance Factors (max 180)', SAPP_SECTION2, 's2', a);
    // Section 3
    if (tpl.supervisory) {
      html += sappFactorEditor('Section 3: Leadership and Management Performance Factors (max 105)', SAPP_SECTION3, 's3', a);
    } else {
      html += '<div class="card" style="margin-bottom:16px;padding:14px;color:var(--text-muted);font-size:13px;">Section 3 (Leadership and Management) applies to supervisory staff only — not scored for ' + esc(tpl.label) + '. Final score = Total × 100 ÷ 280.</div>';
    }

    html += '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3>Summary (auto-calculated)</h3></div><div id="sappSummary"></div></div>';
    host.innerHTML = html;
    sappOnScoreInput();
  }

  function sappFactorEditor(title, defs, key, a) {
    var html = '<div class="card" style="margin-bottom:16px;"><div class="card-header"><h3>' + esc(title) + '</h3><span id="sapp' + key.toUpperCase() + 'Tot" style="font-weight:700;"></span></div>' +
      '<div style="overflow-x:auto;"><table class="data-table sapp-edit-table" style="width:100%;"><thead><tr><th>Performance Criterion</th><th style="width:110px;">Score [1–5]</th><th style="min-width:160px;">Comments</th></tr></thead><tbody>';
    defs.forEach(function (f, fi) {
      html += '<tr><td colspan="3" style="background:var(--bg-card-hover,rgba(127,127,127,.08));"><strong>' + esc(f.name) + '</strong> <span style="font-size:11px;color:var(--text-muted);">' + esc(f.desc) + ' — Max ' + f.max + '</span></td></tr>';
      f.bullets.forEach(function (b, bi) {
        var k = fi + '_' + bi;
        html += '<tr><td style="font-size:12px;">• ' + esc(b) + '</td>' +
          '<td>' + numInput('sapp_' + key + '_' + k, (a[key] || {})[k], 1, 5, 1) + '</td>' +
          '<td><input class="form-control" style="font-size:12px;" id="sapp_c' + key.charAt(1) + '_' + k + '" value="' + esc((a.comments || {})[key + '_' + k] || '') + '"></td></tr>';
      });
      html += '<tr><td style="text-align:right;font-weight:700;">FACTOR TOTAL (Max. ' + f.max + ')</td><td id="sappFT_' + key + '_' + fi + '" style="text-align:center;font-weight:700;"></td><td id="sappFA_' + key + '_' + fi + '" style="font-size:12px;color:var(--text-muted);"></td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  function sappCollectFromForm() {
    var a = sappState.editing;
    if (!a) return null;
    var tpl = SAPP_TEMPLATES[a.template];
    function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
    a.period = val('sappFPeriod') || a.period;
    a.appraiser = val('sappFAppraiser');
    a.lengthSupervising = val('sappFSupervising');
    a.typeOfAppraisal = val('sappFType') || 'Annual';
    if (tpl.hasSkillArea) a.skillArea = val('sappFSkill');
    a.s1 = {}; a.s2 = {}; a.s3 = {}; a.comments = a.comments || {};
    tpl.section1.forEach(function (obj, oi) {
      obj.indicators.forEach(function (ind, ii) {
        var k = oi + '_' + ii;
        var v = val('sapp_s1_' + k);
        if (v !== '') a.s1[k] = sappClamp(v, 0, ind[1]);
        a.comments['s1_' + k] = val('sapp_c1_' + k);
      });
    });
    SAPP_SECTION2.forEach(function (f, fi) {
      f.bullets.forEach(function (_, bi) {
        var k = fi + '_' + bi;
        var v = val('sapp_s2_' + k);
        if (v !== '') a.s2[k] = sappClamp(Math.round(v), 1, 5);
        a.comments['s2_' + k] = val('sapp_c2_' + k);
      });
    });
    if (tpl.supervisory) {
      SAPP_SECTION3.forEach(function (f, fi) {
        f.bullets.forEach(function (_, bi) {
          var k = fi + '_' + bi;
          var v = val('sapp_s3_' + k);
          if (v !== '') a.s3[k] = sappClamp(Math.round(v), 1, 5);
          a.comments['s3_' + k] = val('sapp_c3_' + k);
        });
      });
    }
    return a;
  }

  root.sappOnScoreInput = function () {
    var a = sappCollectFromForm();
    if (!a) return;
    var calc = sappCalc(a);
    var el;
    el = document.getElementById('sappS1Tot');
    if (el) el.textContent = 'Total: ' + calc.s1Total + ' / 100';
    el = document.getElementById('sappS2Tot');
    if (el) el.textContent = 'Total: ' + calc.s2Total + ' / 180';
    el = document.getElementById('sappS3Tot');
    if (el) el.textContent = 'Total: ' + calc.s3Total + ' / 105';
    calc.s2.forEach(function (f, fi) {
      var t = document.getElementById('sappFT_s2_' + fi);
      var av = document.getElementById('sappFA_s2_' + fi);
      if (t) t.textContent = f.entered ? f.total : '';
      if (av) av.textContent = f.avg !== null ? ('Average Score for ' + f.name + ' = ' + f.avg) : '';
    });
    (calc.s3 || []).forEach(function (f, fi) {
      var t = document.getElementById('sappFT_s3_' + fi);
      var av = document.getElementById('sappFA_s3_' + fi);
      if (t) t.textContent = f.entered ? f.total : '';
      if (av) av.textContent = f.avg !== null ? ('Average Score for ' + f.name + ' = ' + f.avg) : '';
    });
    var sm = document.getElementById('sappSummary');
    if (sm) {
      var color = calc.finalPct >= 90 ? 'var(--green)' : calc.finalPct >= 80 ? 'var(--accent)' : calc.finalPct >= 60 ? 'var(--orange)' : 'var(--red)';
      sm.innerHTML =
        '<div style="display:flex;gap:24px;align-items:center;flex-wrap:wrap;padding:6px 0;">' +
        '<table class="data-table" style="min-width:340px;"><thead><tr><th>Sections</th><th>Maximum</th><th>Actual</th></tr></thead><tbody>' +
        '<tr><td>(1) Key Performance Objectives</td><td>100</td><td>' + calc.s1Total + '</td></tr>' +
        '<tr><td>(2) Key Job Performance Factors</td><td>180</td><td>' + calc.s2Total + '</td></tr>' +
        (calc.supervisory ? '<tr><td>(3) Leadership and Management Performance Factors</td><td>105</td><td>' + calc.s3Total + '</td></tr>' : '') +
        '<tr><td><strong>TOTAL SCORE</strong></td><td><strong>' + calc.divisor + '</strong></td><td><strong>' + calc.grandTotal + '</strong></td></tr>' +
        '</tbody></table>' +
        '<div style="text-align:center;flex:1;min-width:200px;">' +
        '<div style="font-size:44px;font-weight:800;color:' + color + ';">' + calc.finalPct + '%</div>' +
        '<div style="font-weight:700;color:' + color + ';">' + esc(calc.category) + '</div>' +
        '<div style="font-size:12px;color:var(--text-muted);margin-top:4px;">' + calc.grandTotal + ' × 100 ÷ ' + calc.divisor + ' = ' + calc.finalPctExact + '%' +
        (calc.payPct != null ? ' • Payment reward: ' + calc.payPct + '% of basic pay' : '') + '</div>' +
        (!calc.complete ? '<div style="font-size:12px;color:var(--orange);margin-top:6px;">Some criteria are not yet scored.</div>' : '') +
        '</div></div>';
    }
    var btn = document.getElementById('sappCompleteBtn');
    if (btn) btn.disabled = !calc.complete;
  };

  root.sappSaveDraft = function () {
    var a = sappCollectFromForm();
    if (!a) return;
    if (a.status !== 'completed') a.status = 'draft';
    sappSaveAppraisal(a);
    if (typeof root.showToast === 'function') root.showToast('Appraisal saved.');
    try { root.sappRenderAdminDueCard(); } catch (e) {}
  };

  root.sappMarkCompleted = function () {
    var a = sappCollectFromForm();
    if (!a) return;
    var calc = sappCalc(a);
    if (!calc.complete) {
      alert('Every performance criterion must be scored before the appraisal can be marked completed.');
      return;
    }
    if (!confirm('Mark this appraisal as COMPLETED?\n\nFinal score: ' + calc.finalPct + '% (' + calc.category + ')\n\nThe grade will appear on ' + a.staffName + '’s dashboard.')) return;
    a.status = 'completed';
    a.completedAt = new Date().toISOString();
    sappSaveAppraisal(a);
    if (typeof root.showToast === 'function') root.showToast('Appraisal completed — ' + calc.finalPct + '% (' + calc.category + ')', 'success');
    if (typeof root.addNotification === 'function') {
      try { root.addNotification('Performance appraisal completed for ' + a.staffName + ' — ' + calc.finalPct + '% (' + calc.category + ') for ' + a.period + '.', 'success', '📋', ['admin']); } catch (e) {}
    }
    // Tell the staff member their instrument is ready for signature on "My Appraisal (Staff)"
    sappNotifyStaffAccount(a.staffName, 'Your performance appraisal for ' + (a.period || a.cycle) + ' is completed (' + calc.finalPct + '% — ' + calc.category + '). Open "My Appraisal (Staff)" to view and sign it.', '📋');
    sappState.editing = null;
    sappRenderPage();
    try { root.sappRenderAdminDueCard(); } catch (e) {}
  };

  /* ==========================================================================
     EXACT-REPLICA INSTRUMENT (live preview + print).
     Reproduces the Centre's Word instrument page-for-page: Times New Roman,
     US Letter, portrait front page, LANDSCAPE Section 1, portrait thereafter.
     All fixed wording is verbatim from the source documents.
     ========================================================================== */
  function docCell(v) { return v === null || v === undefined ? '' : esc(v); }

  /* Render a signature onto the instrument. Unsigned parties keep the
     original blank underscore line (exact replica); signed parties get their
     typed name (script face) or signature image sitting on a ruled line. */
  function sigMark(a, role) {
    var sig = ((a && a.signatures) || {})[role];
    if (!sig || !sig.data) return null;
    return sig.type === 'typed'
      ? '<span class="ap-sig-typed">' + esc(sig.data) + '</span>'
      : '<img class="ap-sig-img" src="' + sig.data + '" alt="signature">';
  }
  function sigLine(a, role, blankLine, minWidth) {
    var m = sigMark(a, role);
    if (!m) return blankLine;
    return '<span class="ap-sig-slot" style="min-width:' + (minWidth || 200) + 'px;">' + m + '</span>';
  }
  function sigDate(a, role, blankLine) {
    var sig = ((a && a.signatures) || {})[role];
    if (!sig || !sig.data || !sig.date) return blankLine;
    return '<span class="ap-sig-slot" style="min-width:90px;">' + esc(sig.date) + '</span>';
  }

  function sappBuildInstrumentHTML(a) {
    var tpl = SAPP_TEMPLATES[a.template];
    var calc = sappCalc(a);
    var c = a.comments || {};
    var completed = a.status === 'completed';
    var h = '';

    /* ---------- PAGE 1 (portrait): cover ---------- */
    h += '<div class="ap-page ap-portrait">';
    h += '<table class="ap-t ap-cover"><tr>' +
      '<td style="width:18%;text-align:center;"><img src="HEART NSTA TRUST - Logo.png" alt="HEART/NSTA Trust" style="max-width:90px;max-height:90px;"></td>' +
      '<td style="text-align:center;"><div class="ap-title1">HAZARD SKILLS TRAINING CENTRE</div><div class="ap-title2">PERFORMANCE MANAGEMENT SYSTEM</div><div class="ap-title2">PERFORMANCE APPRAISAL INSTRUMENT</div></td></tr></table>';
    h += '<table class="ap-t">' +
      '<tr><td colspan="2" class="ap-sechead">A.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;APPRAISEE INFORMATION</td></tr>' +
      '<tr><td style="width:55%;">Name: ' + docCell(a.staffName) + '</td><td>Appraisal period: ' + docCell(a.period) + '</td></tr>' +
      '<tr><td>Position: <b>' + esc(tpl.position) + '</b></td><td>' + (tpl.hasSkillArea ? 'Skill Area: ' + docCell(a.skillArea) : '') + '</td></tr>' +
      '<tr><td colspan="2" class="ap-sechead">B.&nbsp;&nbsp;&nbsp;&nbsp;APPRAISERS INFORMATION</td></tr>' +
      '<tr><td colspan="2">Name: ' + docCell(a.appraiser) + '</td></tr>' +
      '<tr><td colspan="2">Length of time supervising this employee: ' + docCell(a.lengthSupervising) + '</td></tr>' +
      '<tr><td colspan="2" class="ap-sechead">C.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;TYPE OF APPRAISAL</td></tr>' +
      '<tr><td colspan="2">' + docCell(a.typeOfAppraisal || 'Annual') + '</td></tr>' +
      '<tr><td colspan="2" class="ap-sechead">D.&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;FINAL INDIVIDUAL APPRAISAL SCORE</td></tr>' +
      '<tr><td style="text-align:center;"><span class="ap-final-score">' + (completed ? calc.finalPct + '%' : '') + '</span></td>' +
      '<td style="font-size:9pt;">Minimum Performance Score for confirmation is subject to change.<br>For confirmation, the probation period may not exceed six months.</td></tr>' +
      '</table>';
    h += '</div>';

    /* ---------- PAGE 2 (landscape): Section 1 ---------- */
    h += '<div class="ap-page ap-landscape">';
    h += '<div class="ap-s1head"><b>SECTION 1:&nbsp; QUANTATATIVE PERFORMANCE OBJECTIVES</b> In the space provided, specify objectives and the accompanying performance indicators (measures) for the period under review and consider the extent to which they were achieved or fulfilled.&nbsp; Assess actual performance by rating the level of achievement out of the total assigned weight for each indicator.&nbsp; Actual performance score for each indicator in column 4 must therefore not exceed the weight assigned to the indicator in column 3.</div>';
    h += '<table class="ap-t ap-s1"><tr>' +
      '<th style="width:16%;">Objectives<br>Column 1</th><th style="width:40%;">Performance Indicators<br>Column 2</th><th style="width:10%;">Weights Assigned<br>Column 3</th><th style="width:10%;">Actual Score<br>Column 4</th><th style="width:24%;">Comments</th></tr>';
    tpl.section1.forEach(function (obj, oi) {
      obj.indicators.forEach(function (ind, ii) {
        var key = oi + '_' + ii;
        var sc = (a.s1 || {})[key];
        h += '<tr>' +
          (ii === 0 ? '<td rowspan="' + obj.indicators.length + '" style="vertical-align:top;"><b>' + esc(obj.name) + '</b><br><b>Weight: ' + obj.weight + '</b></td>' : '') +
          '<td>' + esc(ind[0]) + '</td>' +
          '<td class="ap-c">' + ind[1] + '</td>' +
          '<td class="ap-c">' + docCell(sc) + '</td>' +
          '<td>' + docCell(c['s1_' + key]) + '</td></tr>';
      });
    });
    h += '<tr><td></td><td></td><td class="ap-c"><b>100</b></td><td class="ap-c"><b>' + (calc.s1Total || '') + '</b></td><td></td></tr>';
    h += '<tr><td></td><td class="ap-c"><b>TOTAL</b></td><td></td><td class="ap-c"><b>' + (calc.s1Total || '') + '</b></td><td></td></tr>';
    h += '</table>';
    h += '<div class="ap-sig">Signed by Appraisee:' + sigLine(a, 'appraisee', '_____________________________________', 240) + 'PERFORMANCE OBJECTIVE SCORE&nbsp; (total of column 4 )&nbsp;&nbsp;&nbsp;&nbsp;<b>' + (completed ? calc.s1Total : '') + '</b></div>';
    h += '</div>';

    /* ---------- PAGE 3 (portrait): rating guides ---------- */
    h += '<div class="ap-page ap-portrait">';
    h += '<div class="ap-h2">SECTIONS 2 &amp; 3: PERFORMANCE FACTOR RATING GUIDES</div>';
    h += '<table class="ap-t"><tr><th style="width:12%;">Score</th><th style="width:30%;">Description</th><th>Details</th></tr>' +
      '<tr><td class="ap-c">5</td><td>Exceptional Performance</td><td>Consistently surpasses the performance standards. Makes significant contributions well beyond normal job responsibilities.</td></tr>' +
      '<tr><td class="ap-c">4</td><td>Exceeds Performance Requirements</td><td>Consistently meets and sometimes surpasses the performance standards.</td></tr>' +
      '<tr><td class="ap-c">3</td><td>Meets Performance Requirements</td><td>Consistently meets the performance standards.</td></tr>' +
      '<tr><td class="ap-c">2</td><td>Marginal Performance/ Needs Improvement</td><td>Occasionally performs below the acceptable level.</td></tr>' +
      '<tr><td class="ap-c">1</td><td>Unsatisfactory Performance</td><td>Consistently performs below the acceptable level.</td></tr></table>';
    h += '<br><table class="ap-t"><tr><th style="width:12%;">Score</th><th style="width:44%;">Attendance</th><th>Punctuality</th></tr>' +
      '<tr><td class="ap-c">5</td><td>Zero (0) to five (5) days absent</td><td>Zero (0)&nbsp; to five (5)&nbsp; times late</td></tr>' +
      '<tr><td class="ap-c">4</td><td>Six (6) to ten (10) days absent</td><td>Six (6) to fourteen&nbsp; (14) times late</td></tr>' +
      '<tr><td class="ap-c">3</td><td>Eleven (11)&nbsp; to fifteen (15) days absent</td><td>Fifteen (15) to twenty-nine (29) times late</td></tr>' +
      '<tr><td class="ap-c">2</td><td>Sixteen (16) to twenty (20) days absent</td><td>Thirty&nbsp; (30) to Fifty (50) times late</td></tr>' +
      '<tr><td class="ap-c">1</td><td>More than twenty&nbsp; (20)&nbsp; days absent</td><td>Over Fifty&nbsp; (50) times late</td></tr></table>';
    h += '<p><b>N.B:</b></p>' +
      '<p>For Sections 2 and 3, each performance criterion (bulleted statement) carries a maximum of five (5) points.</p>' +
      '<p>For Sections 2 and 3, in order to obtain The “Average Score” for each Performance Factor. The factor total is to be divide the by the number of bulleted points (performance criteria) listed under the respective Performance Factor.</p>';
    h += '</div>';

    /* ---------- Section 2 (portrait, grouped as the source document) ---------- */
    var s2groups = [[0, 1], [2, 3, 4], [5, 6, 7], [8, 9]];
    var first2 = true;
    s2groups.forEach(function (grp) {
      h += '<div class="ap-page ap-portrait">';
      if (first2) {
        h += '<div class="ap-s1head"><b>SECTION 2:&nbsp; KEY JOB PERFORMANCE FACTOR</b> Use this section to describe the employee’s performance on each factor.&nbsp; Indicate the appropriate score for each bullet point (performance criteria) in the space provided; maximum score for each bullet is 5 points.&nbsp; Use the RATING GUIDE to determine the scores.</div>';
        first2 = false;
      }
      h += sappFactorDocTable(grp, SAPP_SECTION2, a.s2 || {}, calc.s2, c, 's2');
      h += '</div>';
    });
    // Section 2 sum box + signatures
    h += '<div class="ap-page ap-portrait">';
    h += '<hr class="ap-rule">';
    h += '<table class="ap-t"><tr><td style="width:45%;"><b>SECTION 2 ONLY<br>SUM OF FACTOR TOTALS</b><br><i>(From a maximum score of 180)</i></td>' +
      '<td class="ap-c" style="width:15%;"><b>' + (calc.s2Total || '') + '</b></td><td>Comments:</td></tr></table>';
    h += '<p>Further Comments:</p>';
    h += '<div class="ap-sig">Signed by Appraisee: ' + sigLine(a, 'appraisee', '____________________________________', 220) + '&nbsp;&nbsp; Signed by Appraiser:' + sigLine(a, 'appraiser', '_________________________', 180) + '</div>';
    h += '</div>';

    /* ---------- Section 3 (always printed, scored only for supervisory) ---------- */
    var s3scores = tpl.supervisory ? (a.s3 || {}) : {};
    var s3calc = tpl.supervisory ? calc.s3 : SAPP_SECTION3.map(function (f) { return { name: f.name, total: 0, entered: 0, avg: null }; });
    [[0, 1], [2, 3]].forEach(function (grp) {
      h += '<div class="ap-page ap-portrait">';
      h += sappFactorDocTable(grp, SAPP_SECTION3, s3scores, s3calc, c, 's3');
      h += '</div>';
    });
    h += '<div class="ap-page ap-portrait">';
    h += '<hr class="ap-rule">';
    h += '<table class="ap-t"><tr><td style="width:45%;"><b>SECTION 3 ONLY<br>SUM OF FACTOR TOTALS</b><br><i>(From a maximum score of 105)</i></td>' +
      '<td class="ap-c" style="width:15%;"><b>' + (tpl.supervisory && calc.s3Total ? calc.s3Total : '') + '</b></td><td>Comments</td></tr></table>';
    h += '<p>Further Comments:</p>';
    h += '<div class="ap-sig">Signed by Appraisee: ' + sigLine(a, 'appraisee', '___________________________________', 220) + '&nbsp;&nbsp; Signed by Appraiser: ' + sigLine(a, 'appraiser', '________________________', 180) + '</div>';
    h += '</div>';

    /* ---------- Final calculation page (portrait) ---------- */
    h += '<div class="ap-page ap-portrait">';
    h += '<p><b>1.&nbsp; Calculate the Total Score for Sections 1, 2, and 3 of the Performance Appraisal:</b></p>';
    h += '<table class="ap-t" style="width:85%;margin:0 auto;"><tr><th>Sections</th><th style="width:20%;">Maximum Score</th><th style="width:20%;">Actual Score</th></tr>' +
      '<tr><td>(1)&nbsp;&nbsp; Key Performance Objectives</td><td class="ap-c">100</td><td class="ap-c">' + (completed || calc.s1Total ? calc.s1Total : '') + '</td></tr>' +
      '<tr><td>(2)&nbsp;&nbsp; Key Job Performance Factors</td><td class="ap-c">180</td><td class="ap-c">' + (completed || calc.s2Total ? calc.s2Total : '') + '</td></tr>' +
      '<tr><td>(3) Leadership and Management Performance Factors</td><td class="ap-c">105</td><td class="ap-c">' + (tpl.supervisory ? (calc.s3Total || '') : '0') + '</td></tr>' +
      '<tr><td><b>TOTAL SCORE</b></td><td class="ap-c"><b>' + calc.divisor + '</b></td><td class="ap-c"><b>' + (completed || calc.grandTotal ? calc.grandTotal : '') + '</b></td></tr></table>';
    h += '<p style="margin-top:14px;"><b>2.&nbsp; Calculate the Final Appraisal Score as follows:</b></p>';
    h += '<table style="width:100%;border:none;font-size:10pt;"><tr>' +
      '<td style="border:none;width:50%;">• <b>Non-supervisory staff</b>&nbsp;&nbsp;&nbsp; <u>Total Actual Score</u> x 100<br><span style="margin-left:120px;">280</span></td>' +
      '<td style="border:none;">• <b>Supervisory staff</b>&nbsp; <u>Total Actual Score</u> x 100<br><span style="margin-left:110px;">385</span></td></tr></table>';
    h += '<p style="margin-top:12px;"><b>FINAL APPRAISAL SCORE FOR INDIVIDUAL PERFORMANCE =&nbsp;&nbsp;<span class="ap-final-score">' + (completed ? calc.finalPct + '%' : '') + '</span></b></p>';
    h += '<p><b>3.&nbsp; Place the Final Appraisal Score in the box in Section D on the Front Page of this instrument.</b></p>';
    h += '<p style="margin-top:12px;"><b>PERFORMANCE CATEGORY – based on this year’s individual performance.&nbsp; (Please tick one)</b></p>';
    function tick(cat) { return completed && calc.category === cat ? '☑' : '☐'; }
    h += '<table class="ap-t"><tr>' +
      '<td style="width:50%;">' + tick('Unsatisfactory') + ' <b>Unsatisfactory (0% - 59%)</b><br><i>(The employee does not perform to the acceptable standard required by the organistation)</i><br><br>' +
      tick('Meets Job Requirements') + ' <b>Meets Job Requirements (60% - 79%)</b><br><i>(The employee performs to the acceptable standard required by the organisation.</i></td>' +
      '<td>' + tick('Commendable') + ' <b>Commendable (80% - 89%)</b><br><i>(The employee often performs above the acceptable standard required by the organisation)</i><br><br>' +
      tick('Outstanding') + ' <b>Outstanding&nbsp; (90% and over)</b><br><i>(The employee consistently performs above the acceptable standard&nbsp; required by the organisation)</i></td></tr></table>';
    h += '<p style="margin-top:10px;"><b>Payment Reward Table for Individual Performance Scores 80% and above.</b></p>';
    var scores1 = [80, 81, 82, 83, 84, 85, 86, 87, 88, 89, 90, 91, 92];
    var scores2 = [93, 94, 95, 96, 97, 98, 99, 100];
    function payRow(list) {
      var r1 = '<tr><td><b>Individual Scores</b></td>', r2 = '<tr><td><b>% of Basic Pay</b></td>';
      list.forEach(function (s) {
        var hit = completed && calc.finalPct === s;
        r1 += '<td class="ap-c"' + (hit ? ' style="background:#ffef9e;"' : '') + '>' + s + '</td>';
        r2 += '<td class="ap-c"' + (hit ? ' style="background:#ffef9e;"' : '') + '>' + sappPayReward(s).toFixed(1) + '</td>';
      });
      return '<table class="ap-t" style="font-size:9pt;">' + r1 + '</tr>' + r2 + '</tr></table>';
    }
    h += payRow(scores1) + '<br>' + payRow(scores2);
    h += '<div class="ap-sig" style="margin-top:14px;">Signed by Appraisee:' + sigLine(a, 'appraisee', '____________________________ ', 220) + '&nbsp;&nbsp;&nbsp;&nbsp;Signed by Appraiser: ' + sigLine(a, 'appraiser', '________________________', 180) + '</div>';
    h += '</div>';

    /* ---------- Signatures and comments page ---------- */
    var sigs = a.signatures || {};
    var apeSig = sigs.appraisee, agree = !apeSig || apeSig.agree !== false;
    var apeComment = apeSig && apeSig.comment ? apeSig.comment : '';
    var aprComment = sigs.appraiser && sigs.appraiser.comment ? sigs.appraiser.comment : '';
    var LONG = '_______________________________________________________________________________________________';
    var LONG2 = '_________________________________________________________________________________________________________';
    function overLine(text, blank) {
      if (!text) return blank + '<br>';
      return '<span class="ap-sig-slot" style="min-width:96%;text-align:left;font-size:9.5pt;">' + esc(text) + '</span><br>';
    }
    h += '<div class="ap-page ap-portrait">';
    h += '<table class="ap-t">' +
      '<tr><th class="ap-c">SIGNATURES AND COMMENTS</th></tr>' +
      '<tr><td><b>APPRAISER.</b>&nbsp; Please summarize salient points of the discussion with the employee and add signature.<br>' +
      overLine(aprComment, LONG) +
      LONG + '<br>' +
      LONG + '<br>' +
      LONG + '<br><br>' +
      'Appraiser’s Signature: ' + sigLine(a, 'appraiser', '_______________________________________________', 300) + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date:' + sigDate(a, 'appraiser', '_________________') + '</td></tr>' +
      '<tr><td><b>APPRAISEE:</b>&nbsp;&nbsp; Please sign to validate this Appraisal Form.&nbsp;&nbsp; Comment (if necessary) on the conduct and/or outcome of the appraisal interview.<br>' +
      'COMMENTS:&nbsp;&nbsp;&nbsp; ' + (apeComment ? '' : '__________________________________________________________________________________________') + (apeComment ? '<span class="ap-sig-slot" style="min-width:80%;text-align:left;font-size:9.5pt;">' + esc(apeComment) + '</span>' : '') + '<br>' +
      LONG2 + '<br>' +
      LONG2 + '<br>' +
      LONG2 + '<br>' +
      LONG2 + '</td></tr>' +
      '<tr><td><i>(Please place a tick in the box beside the statement which applies (If you have ticked the second statement, put an X beside conduct and/or outcome to indicate the nature of your disagreement).</i><br><br>' +
      (apeSig && agree ? '☑' : '☐') + ' I Agree with the conduct and outcome of this appraisal&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ' + (apeSig && agree ? sigLine(a, 'appraisee', '________________________________', 220) : '________________________________') + '&nbsp;&nbsp; ' + (apeSig && agree ? sigDate(a, 'appraisee', '_________') : '_________') + '<br>' +
      '<span style="margin-left:340px;">Appraisee’s Signature</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date<br><br>' +
      (apeSig && !agree ? '☑' : '☐') + ' I DO NOT Agree with the&nbsp; ___conduct&nbsp;&nbsp; ___outcome of this appraisal&nbsp; ' + (apeSig && !agree ? sigLine(a, 'appraisee', '______________________________', 200) : '______________________________') + '&nbsp; ' + (apeSig && !agree ? sigDate(a, 'appraisee', '__________') : '__________') + '<br>' +
      '<span style="margin-left:340px;">Appraisee’s Signature</span>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date<br><br>' +
      'CMC Chair’s Signature:&nbsp;&nbsp;&nbsp; ' + sigLine(a, 'cmc', '_____________________________________________________', 320) + '&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Date:' + sigDate(a, 'cmc', '__________') + '</td></tr>' +
      '</table>';
    h += '</div>';

    return h;
  }

  function sappFactorDocTable(indices, defs, scores, calcFactors, comments, key) {
    var h = '<table class="ap-t ap-factors"><tr>' +
      '<th style="width:55%;">PERFORMANCE FACTORS</th>' +
      '<th style="width:15%;">ACTUAL PERFORMANCE SCORE<br>[1 - 5]<br>(Use Rating Guide)</th>' +
      '<th>COMMENTS<br>(Comment on strengths and weaknesses and make suggestions for improvements, where appropriate)</th></tr>';
    indices.forEach(function (fi) {
      var f = defs[fi];
      var cf = calcFactors && calcFactors[fi] ? calcFactors[fi] : { total: 0, entered: 0, avg: null };
      h += '<tr><td colspan="3"><b>' + esc(f.name) + ':</b> <i>' + esc(f.desc) + '</i></td></tr>';
      f.bullets.forEach(function (b, bi) {
        var k = fi + '_' + bi;
        var v = scores[k];
        h += '<tr><td>•&nbsp;' + esc(b) + '</td><td class="ap-c">' + docCell(v) + '</td><td>' + docCell(comments[key + '_' + k]) + '</td></tr>';
      });
      h += '<tr><td><b>FACTOR TOTAL (Max. ' + f.max + ')</b></td><td class="ap-c"><b>' + (cf.entered ? cf.total : '') + '</b></td>' +
        '<td>Average Score for ' + esc(f.avgLabel || f.name) + ' = ' + (cf.avg !== null && cf.entered ? cf.avg : '') + '</td></tr>';
    });
    h += '</table>';
    return h;
  }

  var SAPP_DOC_CSS =
    '.ap-doc{font-family:"Times New Roman",Times,serif;font-size:10pt;color:#000;width:max-content;margin:0 auto;}' +
    '.ap-doc,.ap-doc td,.ap-doc th,.ap-doc p,.ap-doc div,.ap-doc span,.ap-doc b,.ap-doc i{color:#000;}' +
    '.ap-doc p{margin:6px 0;}' +
    '.ap-page{background:#fff;margin:0 auto 18px auto;padding:0.55in;box-shadow:0 1px 6px rgba(0,0,0,.25);box-sizing:border-box;}' +
    '.ap-portrait{width:8.5in;min-height:10.5in;}' +
    '.ap-landscape{width:11in;min-height:8in;}' +
    '.ap-t{width:100%;border-collapse:collapse;}' +
    '.ap-t td,.ap-t th{border:1px solid #000;padding:3px 5px;vertical-align:top;font-size:9.5pt;text-align:left;}' +
    '.ap-t th{font-weight:bold;background:#e8e8e8;}' +
    '.ap-c{text-align:center !important;}' +
    '.ap-cover td{border:1px solid #000;padding:8px;}' +
    '.ap-title1{font-size:16pt;font-weight:bold;}' +
    '.ap-title2{font-size:13pt;font-weight:bold;}' +
    '.ap-sechead{font-weight:bold;background:#e8e8e8;}' +
    '.ap-final-score{font-size:14pt;font-weight:bold;}' +
    '.ap-s1head{font-size:9.5pt;margin-bottom:6px;}' +
    '.ap-h2{font-weight:bold;font-size:12pt;margin-bottom:8px;}' +
    '.ap-sig{margin-top:10px;font-size:10pt;}' +
    '.ap-sig-typed{font-family:"Segoe Script","Brush Script MT","Lucida Handwriting",cursive;font-size:13pt;color:#00008b;}' +
    '.ap-sig-img{height:34px;vertical-align:bottom;}' +
    '.ap-sig-slot{display:inline-block;border-bottom:1px solid #000;text-align:center;vertical-align:bottom;line-height:1.1;padding:0 8px;}' +
    '.ap-rule{border:none;border-top:1px dashed #000;margin:8px 0;}' +
    '@media print{' +
    'body{margin:0;background:#fff;}' +
    '.ap-doc{width:auto;}' +
    '.ap-page{box-shadow:none;margin:0;width:auto;min-height:0;padding:0;page-break-after:always;}' +
    '.ap-portrait{page:apPortrait;}' +
    '.ap-landscape{page:apLandscape;}' +
    '}' +
    '@page apPortrait{size:8.5in 11in;margin:0.5in;}' +
    '@page apLandscape{size:11in 8.5in;margin:0.5in;}';

  root.sappOpenPreview = function (staffId) {
    var staff = sappRoster().filter(function (s) { return s.id === staffId; })[0];
    var a = (sappState.editing && sappState.editing.staffId === staffId)
      ? (sappCollectFromForm() || sappState.editing)
      : (sappGetAppraisal(sappState.cycleKey, staffId) || (staff && sappNewAppraisal(staff, sappState.cycleKey)));
    if (!a) return;
    var ov = document.getElementById('sappPreviewOverlay');
    var bd = document.getElementById('sappPreviewBody');
    if (!ov || !bd) return;
    // Portal the overlay to <body> so no ancestor stacking context (page
    // transitions, sidebar) can sit above it or clip it.
    if (ov.parentElement !== document.body) document.body.appendChild(ov);
    bd.innerHTML = '<style>' + SAPP_DOC_CSS + '</style><div class="ap-doc">' + sappBuildInstrumentHTML(a) + '</div>';
    ov.style.display = 'flex';
    ov.setAttribute('data-staff', staffId);
  };
  root.sappClosePreview = function () {
    var ov = document.getElementById('sappPreviewOverlay');
    if (ov) ov.style.display = 'none';
  };

  /* Print an exact-replica PDF via a dedicated print window (portrait cover,
     landscape Section 1) — use the browser's "Save as PDF" destination. */
  root.sappPrint = function (staffId) {
    var staff = sappRoster().filter(function (s) { return s.id === staffId; })[0];
    var a = (sappState.editing && sappState.editing.staffId === staffId)
      ? (sappCollectFromForm() || sappState.editing)
      : (sappGetAppraisal(sappState.cycleKey, staffId) || (staff && sappNewAppraisal(staff, sappState.cycleKey)));
    if (!a) return;
    root.sappPrintAppraisal(a);
  };
  root.sappPrintAppraisal = function (a) {
    if (!a) return;
    var w = window.open('', '_blank');
    if (!w) { alert('Please allow pop-ups to print the appraisal.'); return; }
    w.document.write('<!DOCTYPE html><html><head><title>Appraisal Instrument — ' + esc(a.staffName) + '</title>' +
      '<style>' + SAPP_DOC_CSS + 'body{background:#777;}</style></head><body>' +
      '<div class="ap-doc">' + sappBuildInstrumentHTML(a) + '</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print();},350);};<\/script>' +
      '</body></html>');
    w.document.close();
  };

  /* ==========================================================================
     "MY APPRAISAL (STAFF)" — signing page, mounted for four roles.
     Once the Administrator marks an appraisal COMPLETED, the instrument (the
     exact-replica PDF) appears here for signing:
       - staff (instructor / admin staff)  → sign as Appraisee
       - Administrator (Coordinator)       → sign as Appraiser
       - CMC (Board)                       → sign as CMC Chair
     Signatures can be typed (script face), drawn on a canvas, or uploaded as
     a PNG image, and are rendered onto the instrument's signature lines.
     ========================================================================== */
  var sappMy = {}; // per-prefix view state

  function sappSignerRole() {
    var r = null;
    try { r = root.currentRole; } catch (e) {}
    if (r === 'admin') return 'appraiser';
    if (r === 'cmc') return 'cmc';
    if (r === 'instructor' || r === 'adminstaff') return 'appraisee';
    return null;
  }
  function sappSignerName() {
    try {
      if (root.currentLoggedInUser && root.currentLoggedInUser.name) return root.currentLoggedInUser.name;
      if (root.currentInstructor && root.currentInstructor.name) return root.currentInstructor.name;
    } catch (e) {}
    return '';
  }
  function sappRoleTitle(role) {
    return role === 'appraiser' ? 'Appraiser (Coordinator/Administrator)'
      : role === 'cmc' ? 'CMC Chair' : 'Appraisee (Staff Member)';
  }
  function sappTodayStr() {
    var d = new Date();
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  /* All COMPLETED appraisals, newest cycle first. */
  function sappCompletedAppraisals() {
    var d = sappData(), out = [];
    Object.keys(d.cycles).sort().reverse().forEach(function (ck) {
      Object.keys(d.cycles[ck]).forEach(function (sid) {
        var a = d.cycles[ck][sid];
        if (a && a.status === 'completed') out.push(a);
      });
    });
    return out;
  }
  function sappMyList(role) {
    var all = sappCompletedAppraisals();
    if (role !== 'appraisee') return all;
    var me = sappSignerName();
    return all.filter(function (a) { return sappSamePerson(a.staffName, me); });
  }
  function sappNotifyStaffAccount(staffName, text, icon) {
    try {
      var acct = (root.userAccounts || []).filter(function (u) {
        return u && (u.role === 'instructor' || u.role === 'adminstaff') && sappSamePerson(u.name, staffName);
      })[0];
      if (acct && typeof root.addNotificationForUser === 'function') {
        root.addNotificationForUser(text, 'info', icon || '📋', acct.id, acct.role);
      }
    } catch (e) {}
  }

  root.sappMyApprOnShow = function (prefix) {
    prefix = prefix || 'admin';
    var el = document.getElementById(prefix + 'SappMyApprRoot');
    if (!el) return;
    var role = sappSignerRole();
    if (!role) {
      el.innerHTML = '<div class="card" style="padding:32px;text-align:center;color:var(--text-muted);">Please sign in to view appraisals.</div>';
      return;
    }
    if (!sappMy[prefix]) sappMy[prefix] = { view: 'list', method: 'typed', uploadData: null };
    var st = sappMy[prefix];
    if (st.view === 'sign' && st.cycle && st.staffId) sappMyRenderSign(el, prefix);
    else sappMyRenderList(el, prefix);
  };

  function sappMyRenderList(el, prefix) {
    var role = sappSignerRole();
    var list = sappMyList(role);
    var html = '<div class="card" style="margin-bottom:16px;">' +
      '<div class="card-header"><h3>My Appraisal (Staff)</h3><span style="font-size:12px;color:var(--text-muted);">You sign as: <strong>' + esc(sappRoleTitle(role)) + '</strong></span></div>' +
      '<p style="font-size:13px;color:var(--text-muted);margin:0;">Completed performance appraisals appear here as the official Performance Appraisal Instrument (printable PDF). ' +
      'Sign on your signature line by typing your name, signing digitally, or uploading a signature PNG.</p></div>';

    if (!list.length) {
      html += '<div class="card" style="padding:36px;text-align:center;color:var(--text-muted);">' +
        '<div style="font-size:38px;margin-bottom:10px;">🖋️</div>' +
        (role === 'appraisee'
          ? 'No completed appraisal is available for you yet. Your appraisal will appear here when the Administrator completes it.'
          : 'No completed staff appraisals awaiting signature yet.') + '</div>';
      el.innerHTML = html;
      return;
    }

    var rows = list.map(function (a) {
      var calc = sappCalc(a) || {};
      var st = sappSignatureStatus(a);
      function chip(label, on, mine) {
        return '<span style="font-size:11px;padding:2px 8px;border-radius:10px;margin-right:4px;white-space:nowrap;' +
          (on ? 'background:rgba(46,204,113,.15);color:var(--green);' : 'background:rgba(240,165,0,.12);color:var(--orange);') + '">' +
          (on ? '✓ ' : '· ') + label + (mine && !on ? ' (you)' : '') + '</span>';
      }
      var chips = chip('Appraisee', st.appraisee, role === 'appraisee') + chip('Appraiser', st.appraiser, role === 'appraiser') + chip('CMC', st.cmc, role === 'cmc');
      var mineDone = st[role];
      var btn = '<button class="btn ' + (mineDone ? 'btn-secondary' : 'btn-primary') + ' btn-sm" onclick="sappMyOpenSign(\'' + esc(prefix) + '\',\'' + esc(a.cycle) + '\',\'' + esc(a.staffId) + '\')">' + (mineDone ? 'View' : 'View & Sign') + '</button>';
      return '<tr>' +
        '<td><div style="font-weight:600;">' + esc(a.staffName) + '</div><div style="font-size:11px;color:var(--text-muted);">' + esc((SAPP_TEMPLATES[a.template] || {}).label || a.template) + '</div></td>' +
        '<td>' + esc(a.period || a.cycle) + '</td>' +
        '<td><strong>' + (calc.finalPct != null ? calc.finalPct + '%' : '—') + '</strong> <span style="font-size:11px;color:var(--text-muted);">' + esc(calc.category || '') + '</span></td>' +
        '<td>' + chips + (st.fullySigned ? '<div style="font-size:11px;color:var(--green);margin-top:2px;">Fully signed</div>' : '') + '</td>' +
        '<td>' + btn + '</td></tr>';
    }).join('');

    html += '<div class="card"><div style="overflow-x:auto;"><table class="data-table" style="width:100%;">' +
      '<thead><tr><th>Staff Member</th><th>Appraisal Period</th><th>Final Score</th><th>Signatures</th><th>Action</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
    el.innerHTML = html;
  }

  root.sappMyOpenSign = function (prefix, cycle, staffId) {
    var st = sappMy[prefix] = sappMy[prefix] || {};
    st.view = 'sign'; st.cycle = cycle; st.staffId = staffId; st.method = 'typed'; st.uploadData = null;
    var el = document.getElementById(prefix + 'SappMyApprRoot');
    if (el) sappMyRenderSign(el, prefix);
  };
  root.sappMyBack = function (prefix) {
    if (sappMy[prefix]) sappMy[prefix].view = 'list';
    root.sappMyApprOnShow(prefix);
  };

  function sappMyLoadTarget(prefix) {
    var st = sappMy[prefix];
    if (!st) return null;
    return sappGetAppraisal(st.cycle, st.staffId);
  }

  function sappMyRenderSign(el, prefix) {
    var role = sappSignerRole();
    var a = sappMyLoadTarget(prefix);
    if (!a) { root.sappMyBack(prefix); return; }
    // An appraisee may only open their own instrument.
    if (role === 'appraisee' && !sappSamePerson(a.staffName, sappSignerName())) { root.sappMyBack(prefix); return; }
    var st = sappMy[prefix];
    var sigSt = sappSignatureStatus(a);
    var mine = (a.signatures || {})[role];

    var html = '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;">' +
      '<button class="btn btn-secondary" onclick="sappMyBack(\'' + esc(prefix) + '\')">← Back</button>' +
      '<h3 style="margin:0;flex:1;">Appraisal Instrument — ' + esc(a.staffName) + ' (' + esc(a.period || a.cycle) + ')</h3>' +
      '<button class="btn btn-secondary" onclick="sappMyPrint(\'' + esc(prefix) + '\')">🖨 Print / Save as PDF</button></div>';

    // Signing panel
    html += '<div class="card" style="margin-bottom:16px;">' +
      '<div class="card-header"><h3>Your Signature — ' + esc(sappRoleTitle(role)) + '</h3>' +
      (mine && mine.data ? '<span style="color:var(--green);font-weight:600;font-size:13px;">✓ Signed on ' + esc(mine.date || '') + '</span>' : '<span style="color:var(--orange);font-size:13px;">Awaiting your signature</span>') + '</div>';

    html += '<div class="sapp-sign-tabs">' +
      ['typed', 'drawn', 'upload'].map(function (m) {
        var lbl = m === 'typed' ? '⌨ Type your name' : m === 'drawn' ? '✍ Sign digitally' : '🖼 Upload signature PNG';
        return '<div class="sapp-sign-tab' + (st.method === m ? ' active' : '') + '" onclick="sappMySetMethod(\'' + esc(prefix) + '\',\'' + m + '\')">' + lbl + '</div>';
      }).join('') + '</div>';

    if (st.method === 'typed') {
      html += '<div class="form-group"><label>Type your full name as your signature</label>' +
        '<input class="form-control" id="' + prefix + 'SappSigTyped" value="' + esc((mine && mine.type === 'typed' ? mine.data : '') || sappSignerName()) + '" oninput="sappMyTypedPreview(\'' + esc(prefix) + '\')" style="max-width:380px;"></div>' +
        '<div class="sapp-sig-preview-typed" id="' + prefix + 'SappSigTypedPreview" style="max-width:380px;"></div>';
    } else if (st.method === 'drawn') {
      html += '<div style="max-width:520px;">' +
        '<canvas id="' + prefix + 'SappSigCanvas" class="sapp-sign-canvas" width="500" height="150" style="width:100%;"></canvas>' +
        '<div style="margin-top:8px;display:flex;gap:8px;">' +
        '<button class="btn btn-secondary btn-sm" onclick="sappMyClearCanvas(\'' + esc(prefix) + '\')">Clear</button>' +
        '<span style="font-size:12px;color:var(--text-muted);align-self:center;">Sign inside the box with your mouse or finger.</span></div></div>';
    } else {
      html += '<div class="form-group"><label>Upload your signature image (PNG, transparent background recommended)</label>' +
        '<input type="file" accept="image/png,image/jpeg" id="' + prefix + 'SappSigFile" class="form-control" style="max-width:380px;" onchange="sappMyUploadChange(\'' + esc(prefix) + '\')"></div>' +
        '<div id="' + prefix + 'SappSigUploadPreview" style="background:#fff;border-radius:8px;padding:8px;max-width:380px;min-height:52px;">' +
        (st.uploadData ? '<img src="' + st.uploadData + '" style="height:44px;">' : '<span style="color:#888;font-size:12px;">No image selected' + (mine && mine.type === 'upload' ? ' — current signature on file will be kept unless you choose a new image.' : '') + '</span>') + '</div>';
    }

    if (role === 'appraisee') {
      var agreeNow = !mine || mine.agree !== false;
      html += '<div class="form-group" style="margin-top:14px;"><label>Conduct and outcome of this appraisal</label>' +
        '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:13px;">' +
        '<label style="display:flex;align-items:center;gap:6px;"><input type="radio" name="' + prefix + 'SappAgree" id="' + prefix + 'SappAgreeYes" ' + (agreeNow ? 'checked' : '') + '> I AGREE with the conduct and outcome</label>' +
        '<label style="display:flex;align-items:center;gap:6px;"><input type="radio" name="' + prefix + 'SappAgree" id="' + prefix + 'SappAgreeNo" ' + (!agreeNow ? 'checked' : '') + '> I DO NOT agree</label></div></div>';
      html += '<div class="form-group"><label>Comments (optional — appears in the COMMENTS section of the instrument)</label>' +
        '<textarea class="form-control" id="' + prefix + 'SappSigComment" rows="2" style="max-width:640px;">' + esc(mine && mine.comment ? mine.comment : '') + '</textarea></div>';
    } else if (role === 'appraiser') {
      html += '<div class="form-group" style="margin-top:14px;"><label>Summary of discussion with the employee (optional — appears in the APPRAISER section)</label>' +
        '<textarea class="form-control" id="' + prefix + 'SappSigComment" rows="2" style="max-width:640px;">' + esc(mine && mine.comment ? mine.comment : '') + '</textarea></div>';
    }

    html += '<div style="margin-top:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="sappMyApplySignature(\'' + esc(prefix) + '\')">' + (mine && mine.data ? 'Update Signature' : 'Apply Signature') + '</button>' +
      '<span style="font-size:12px;color:var(--text-muted);">Signing as ' + esc(sappSignerName()) + ' • Date: ' + sappTodayStr() + '</span></div>';
    html += '</div>';

    // Signature progress
    function prog(lbl, on) { return '<span style="margin-right:14px;' + (on ? 'color:var(--green);' : 'color:var(--text-muted);') + '">' + (on ? '✓' : '○') + ' ' + lbl + '</span>'; }
    html += '<div class="card" style="margin-bottom:16px;padding:12px 18px;font-size:13px;">' +
      prog('Appraisee', sigSt.appraisee) + prog('Appraiser', sigSt.appraiser) + prog('CMC Chair', sigSt.cmc) +
      (sigSt.fullySigned ? '<strong style="color:var(--green);">— Instrument fully signed</strong>' : '') + '</div>';

    // The instrument itself (exact replica, with signatures rendered)
    html += '<div class="sapp-doc-scroll"><style>' + SAPP_DOC_CSS + '</style><div class="ap-doc">' + sappBuildInstrumentHTML(a) + '</div></div>';

    el.innerHTML = html;
    if (st.method === 'typed') root.sappMyTypedPreview(prefix);
    if (st.method === 'drawn') sappMyWireCanvas(prefix);
  }

  root.sappMySetMethod = function (prefix, m) {
    if (!sappMy[prefix]) return;
    sappMy[prefix].method = m;
    var el = document.getElementById(prefix + 'SappMyApprRoot');
    if (el) sappMyRenderSign(el, prefix);
  };
  root.sappMyTypedPreview = function (prefix) {
    var inp = document.getElementById(prefix + 'SappSigTyped');
    var pv = document.getElementById(prefix + 'SappSigTypedPreview');
    if (inp && pv) pv.textContent = inp.value || ' ';
  };
  function sappMyWireCanvas(prefix) {
    var cv = document.getElementById(prefix + 'SappSigCanvas');
    if (!cv) return;
    var ctx = cv.getContext('2d');
    ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#00187a';
    var drawing = false, hasInk = false;
    function pos(e) {
      var r = cv.getBoundingClientRect();
      var sx = cv.width / r.width, sy = cv.height / r.height;
      return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
    }
    cv.addEventListener('pointerdown', function (e) { drawing = true; hasInk = true; cv.setPointerCapture(e.pointerId); var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); });
    cv.addEventListener('pointermove', function (e) { if (!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); });
    cv.addEventListener('pointerup', function () { drawing = false; });
    cv.addEventListener('pointerleave', function () { drawing = false; });
    cv._sappHasInk = function () { return hasInk; };
    cv._sappReset = function () { ctx.clearRect(0, 0, cv.width, cv.height); hasInk = false; };
  }
  root.sappMyClearCanvas = function (prefix) {
    var cv = document.getElementById(prefix + 'SappSigCanvas');
    if (cv && cv._sappReset) cv._sappReset();
  };
  root.sappMyUploadChange = function (prefix) {
    var inp = document.getElementById(prefix + 'SappSigFile');
    var f = inp && inp.files && inp.files[0];
    if (!f) return;
    if (f.size > 400 * 1024) { alert('Signature image is too large — please use an image under 400 KB.'); inp.value = ''; return; }
    var rd = new FileReader();
    rd.onload = function () {
      sappMy[prefix].uploadData = rd.result;
      var pv = document.getElementById(prefix + 'SappSigUploadPreview');
      if (pv) pv.innerHTML = '<img src="' + rd.result + '" style="height:44px;">';
    };
    rd.readAsDataURL(f);
  };

  root.sappMyApplySignature = function (prefix) {
    var role = sappSignerRole();
    var a = sappMyLoadTarget(prefix);
    if (!role || !a) return;
    if (role === 'appraisee' && !sappSamePerson(a.staffName, sappSignerName())) {
      alert('You can only sign your own appraisal.'); return;
    }
    var st = sappMy[prefix];
    // signedAt (ISO) is what the cloud merge compares when two devices hold the
    // same signature slot; `date` is the human date printed on the instrument.
    var sig = { type: st.method, name: sappSignerName(), date: sappTodayStr(), signedAt: new Date().toISOString() };
    if (st.method === 'typed') {
      var t = (document.getElementById(prefix + 'SappSigTyped') || {}).value || '';
      if (!t.trim()) { alert('Please type your name to sign.'); return; }
      sig.data = t.trim();
    } else if (st.method === 'drawn') {
      var cv = document.getElementById(prefix + 'SappSigCanvas');
      if (!cv || !cv._sappHasInk || !cv._sappHasInk()) { alert('Please draw your signature in the box first.'); return; }
      sig.data = cv.toDataURL('image/png');
    } else {
      var existing = (a.signatures || {})[role];
      sig.data = st.uploadData || (existing && existing.type === 'upload' ? existing.data : null);
      if (!sig.data) { alert('Please choose a signature PNG image to upload.'); return; }
      sig.type = 'upload';
    }
    var cEl = document.getElementById(prefix + 'SappSigComment');
    if (cEl) sig.comment = cEl.value.trim();
    if (role === 'appraisee') {
      var no = document.getElementById(prefix + 'SappAgreeNo');
      sig.agree = !(no && no.checked);
    }
    a.signatures = a.signatures || {};
    a.signatures[role] = sig;
    sappSaveAppraisal(a);
    if (typeof root.showToast === 'function') root.showToast('Signature applied to the appraisal instrument.', 'success');
    // Cross-notify the other parties
    try {
      if (role !== 'appraiser' && typeof root.addNotification === 'function') {
        root.addNotification(esc(sig.name) + ' signed the appraisal instrument for ' + a.staffName + ' (' + (a.period || a.cycle) + ') as ' + sappRoleTitle(role) + '.', 'info', '🖋️', ['admin']);
      }
      if (role !== 'appraisee') {
        sappNotifyStaffAccount(a.staffName, 'Your performance appraisal for ' + (a.period || a.cycle) + ' has been signed by the ' + sappRoleTitle(role) + '.', '🖋️');
      }
    } catch (e) {}
    var el = document.getElementById(prefix + 'SappMyApprRoot');
    if (el) sappMyRenderSign(el, prefix);
  };

  root.sappMyPrint = function (prefix) {
    var a = sappMyLoadTarget(prefix);
    if (a) root.sappPrintAppraisal(a);
  };

})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
