/* ============================================================================
   cestis-config.js — the Centre's own accounts, in ONE place.

   Every page that syncs, signs in with Google or sends e-mail reads these
   values from here (window.CESTIS_CONFIG). They used to be typed into about
   nineteen places across the pages, so moving the Centre to a new Google
   account meant finding and editing every one.

   IF THE CENTRE CHANGES ITS GOOGLE ACCOUNT (or a folder is lost and remade):
     1. Make the folders again in the new account (or note the new folder).
     2. Open the folder in Google Drive; its id is the last part of the
        address: https://drive.google.com/drive/folders/<THIS PART>
     3. Paste each id below, in place of the old one, keeping the quotes.
     4. A new Google sign-in client: paste its id as googleClientId; a new
        EmailJS account: paste its public key, service id and template id.
     5. Run `npm run build:offline` (it stamps the version tags and updates the
        Offline System), commit, and publish.
   The trainee sign-in program (trainee-gate/Gate.gs) keeps its own copy of
   the sign-in client id: change GATE_DEFAULT_CLIENT_ID there too and run
   `npm run build:gate` (or set its GOOGLE_CLIENT_ID script property).
   docs/UPGRADE-2026-10.md, "Changing the Centre's account", has the details.

   Nothing here is secret: these ids are visible to anyone who opens the site,
   by nature (the public repository has always carried them). Never put a
   password, a private key or a secret in this file.
   ============================================================================ */
(function (root) {
  'use strict';

  var CONFIG = {
    // The Google sign-in client every page uses for sync and email sign-in.
    googleClientId: '302497466088-0b619cqa9qno2c606k4rqp742lebc5o8.apps.googleusercontent.com',

    // EmailJS: e-mailed sign-in codes, password resets and notices.
    emailjs: {
      publicKey: 'z_6Ya8J_WGJjRIGuX',
      serviceId: 'service_v49btoq',
      templateId: 'template_80h43gm'
    },

    // The Centre's Google Drive folders.
    folders: {
      mainBackup: '1lNpI00Et1BN5c4eaV5WfQwuQVhCMBtv8',       // the dashboard's main backup (Main Backup)
      onlineExams: '18ACBw0kRi0BssLEoZLWoeXNa1EiANeBu',      // Online Exams backup copy
      lmsChat: '1ashmmL0ZS7mW6XrwoxMuamf7yjtVWHyO',          // LMS Chat backup copy
      classRecordings: '1Yp9aLXGGjhojF1J04QxoNG-9yEgaiS-A',  // live-class recordings
      assignments: '1SEjU_-8XOPM-C2q-Vo-EZUgBz3PMg5Ma',      // assignments and submitted work
      resources: '122aVdNWxJG9ShRWf9Xso0MdXGdQeDuyt',        // the Resource Manager's files
      perUser: '1w23WEyGuRduVM9irEkgOjXaIStBy5i0J',          // each person's own backup
      shared: '11vWe_Nc40TtJ1Hi7PoE7EZ3JrpR-K0Vj',           // School Fee, Clock-in and every page's shared file
      masterSnapshot: '1-BVqRHL3bh0UB30pvlXt0AWAsKWsueec',   // the whole-Centre master backup
      certTemplates: '1iLju3l6nBG3oLdiOGuDqtRuwkZjDWsIQ',    // certificate designs' pictures
      cashbook: '1aL_QZiJ5rmxQUBhj261PzdbYXrI5doOO',         // the Cashbook
      vouchers: '1G6ipD_pGVItBvlPx0LGbD6Prj6AXW303',         // Virement Requests and Payment Vouchers
      feeDocuments: '1akzg0zD4y1auX2RR8Um4AgKgmWrPn9nJ',     // School Fee's trainee documents
      payroll: '1JY8N-AXxxM_eQJ3Gfr0OKBoK4rKchdeV',          // Payroll
      qualPlans: '1xwBUcgAmiw6LR0oOq4cyqD-VoGQA2P_Z'         // Qualification Plans
    },

    // Single files the pages read.
    files: {
      // The payroll rates file (a public copy of payroll-rates.json). Payroll
      // reads this site's own payroll-rates.json first.
      payrollRates: '1F_GCD8rM4SltmcyGMlUG-EXBsvTQLWWR'
    }
  };

  (function freeze(o) { Object.keys(o).forEach(function (k) { if (o[k] && typeof o[k] === 'object') freeze(o[k]); }); Object.freeze(o); })(CONFIG);

  if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
  if (root) root.CESTIS_CONFIG = CONFIG;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
