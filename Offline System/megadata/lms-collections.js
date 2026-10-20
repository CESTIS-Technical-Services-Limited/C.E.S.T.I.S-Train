/* MegaData — the ONE LMS collections table: names, kinds, modes and id
   derivations for every dashboard collection. Shared verbatim by the
   bootstrap 'lms-backup' extractor and the live index.html bridge so the
   two can never drift (the same discipline as cashbook-shared). Modes:
     array  — list of id-carrying records            (docKey kind|id)
     objmap — { key → value } map                    (docKey kind|key)
     msgmap — { roomId → [messages with ids] }       (docKey kind|msgId)
     single — one settings-style object              (docKey kind|singleton) */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.MegaData = Object.assign(root.MegaData || {}, api);
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  var LMS_COLLECTIONS = [
    { names: ['userAccounts', 'voctrain_users'], kind: 'account', mode: 'array', idOf: function (r) { return r.id || r.username; } },
    { names: ['exams', 'voctrain_exams'], kind: 'exam', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['announcements', 'voctrain_announcements'], kind: 'announcement', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['calendarEvents', 'voctrain_calendarEvents'], kind: 'calendarEvent', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['classSessions', 'voctrain_classSessions'], kind: 'classSession', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['adminMeetings', 'voctrain_adminMeetings'], kind: 'adminMeeting', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['instructorAssignments', 'voctrain_assignments'], kind: 'assignment', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['assignmentSubmissions', 'voctrain_submissions'], kind: 'submission', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['instructorResources', 'voctrain_resources'], kind: 'resource', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['driveResources', 'voctrain_driveResources'], kind: 'driveResource', mode: 'array', idOf: function (r) { return r.id || r.fileId; } },
    { names: ['supportMessages', 'voctrain_support_messages'], kind: 'supportMessage', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['notifications', 'voctrain_notifications'], kind: 'notification', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['vcSessions', 'voctrain_vcSessions'], kind: 'vcSession', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['certDownloadApprovals', 'voctrain_certDownloadApprovals'], kind: 'certApproval', mode: 'array', idOf: function (r) { return r.id || (r.studentId && 'CDA-' + r.studentId); } },
    { names: ['adrTasks', 'voctrain_adrTasks'], kind: 'adrTask', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['instructorData', 'voctrain_instructorData'], kind: 'instructorRecord', mode: 'array', idOf: function (r) { return r.id || r.name; } },
    { names: ['skillAreas', 'voctrain_skillAreas'], kind: 'skillArea', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['documentHubFiles', 'voctrain_documentHubFiles'], kind: 'docHubFile', mode: 'array', idOf: function (r) { return r.id || r.fileId; } },
    { names: ['chatRooms', 'voctrain_chatRooms'], kind: 'chatRoom', mode: 'array', idOf: function (r) { return r.id; } },
    { names: ['chatMessages', 'voctrain_chatMessages'], kind: 'chatMessage', mode: 'msgmap' },
    { names: ['chatProfiles', 'voctrain_chatProfiles'], kind: 'chatProfile', mode: 'objmap' },
    { names: ['chatFollows', 'voctrain_chatFollows'], kind: 'chatFollow', mode: 'objmap' },
    { names: ['studentProfiles', 'voctrain_studentProfiles'], kind: 'studentProfile', mode: 'objmap' },
    { names: ['instructorProfiles', 'voctrain_instructorProfiles'], kind: 'instructorProfile', mode: 'objmap' },
    { names: ['certTemplates', 'voctrain_certTemplates'], kind: 'certTemplate', mode: 'objmap' },
    { names: ['systemSettings', 'voctrain_systemSettings'], kind: 'systemSettings', mode: 'single' },
    { names: ['certTemplateCourseMap', 'voctrain_certTemplateCourseMap'], kind: 'certTemplateCourseMap', mode: 'single' },
    { names: ['adminStaffAccessSettings', 'voctrain_adminStaffAccess'], kind: 'adminStaffAccess', mode: 'single' },
    { names: ['adrStaffMeta', 'voctrain_adrStaffMeta'], kind: 'adrStaffMeta', mode: 'single' },
    { names: ['staffAppraisals', 'cestisStaffAppraisals'], kind: 'appraisalStore', mode: 'single' }
  ];

  return { LMS_COLLECTIONS: LMS_COLLECTIONS };
});
