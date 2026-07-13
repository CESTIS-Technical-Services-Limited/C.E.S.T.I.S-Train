/* ============================================================================
   finance-logos.js — the fixed brand marks that appear on the printed finance
   documents. These are the real CESTIS / HEART-NSTA logos rebuilt as inline
   SVG so they render crisply on screen and in print without depending on a
   user-uploaded image.

     FINANCE_LOGOS.shield     — CESTIS educational crest (green), used on the
                                School / RBF (HEART-NSTA) subvention invoice.
     FINANCE_LOGOS.technical  — CESTIS Technical Services Ltd (red / blue),
                                used on the commercial invoice and quote.
     FINANCE_LOGOS.heart      — HEART / NSTA Trust, used on the cheque voucher.

   Each value is a self-contained <svg> string.
   ============================================================================ */
(function (root) {
  'use strict';

  /* ---------------------------------------------------------- CESTIS crest */
  /* Green laurel wreath around a blue-edged shield split into four quadrants
     (book & pens, bed, chef's hat & cutlery, power saw) over a scrolled
     banner reading EMPOWERING COMMUNITIES · YHWH. */
  function laurel(side) {
    // a sprig of leaves following a circular arc down one side of the crest,
    // from near the top (12 o'clock) round to the banner. side = 1 right / -1 left.
    var cx = 250, cy = 262, r = 172, leaves = '';
    var a0 = 16, a1 = 158, steps = 13;                     // degrees, measured from top
    for (var i = 0; i <= steps; i++) {
      var phi = a0 + (a1 - a0) * i / steps;
      var rad = phi * Math.PI / 180;
      var x = cx + side * r * Math.sin(rad);
      var y = cy - r * Math.cos(rad);
      var lean = side * phi;                               // leaf lies along the arc
      leaves += '<g transform="translate(' + x.toFixed(1) + ',' + y.toFixed(1) + ') rotate(' + lean.toFixed(1) + ')">'
              + '<ellipse cx="0" cy="0" rx="6.5" ry="13" fill="#2f9e44"/>'
              + '<ellipse cx="' + (side * 9) + '" cy="4" rx="5" ry="10" fill="#38b24a"/></g>';
    }
    return '<g>' + leaves + '</g>';
  }

  var CREST = '<svg viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Community Educational and Skills Training Institute and Services Ltd">'
    + laurel(-1) + laurel(1)
    // shield
    + '<path d="M250 118 C310 150 372 154 402 152 C402 300 360 372 250 424 C140 372 98 300 98 152 C128 154 190 150 250 118 Z" fill="#ffffff" stroke="#1f5fbf" stroke-width="9"/>'
    + '<path d="M250 118 C310 150 372 154 402 152 C402 300 360 372 250 424 C140 372 98 300 98 152 C128 154 190 150 250 118 Z" fill="none" stroke="#2f9e44" stroke-width="3" transform="scale(0.955) translate(11.5 11.5)"/>'
    // quartering lines (dotted)
    + '<line x1="250" y1="128" x2="250" y2="416" stroke="#1f5fbf" stroke-width="3" stroke-dasharray="4 6"/>'
    + '<line x1="105" y1="262" x2="395" y2="262" stroke="#1f5fbf" stroke-width="3" stroke-dasharray="4 6"/>'
    // TL — book & pens
    + '<g stroke="#2f9e44" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round">'
    +   '<rect x="150" y="170" width="52" height="62" rx="3"/><line x1="176" y1="172" x2="176" y2="230"/>'
    +   '<line x1="214" y1="166" x2="214" y2="236"/><line x1="228" y1="166" x2="228" y2="236"/>'
    +   '<path d="M214 166 l7 -12 l7 12"/></g>'
    // TR — bed
    + '<g stroke="#2f9e44" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round">'
    +   '<path d="M286 226 v-46 a6 6 0 0 1 6 -6 h20 a6 6 0 0 1 6 6 v18"/>'
    +   '<path d="M324 192 h34 a6 6 0 0 1 6 6 v28"/><line x1="286" y1="210" x2="364" y2="210"/>'
    +   '<line x1="286" y1="226" x2="286" y2="240"/><line x1="364" y1="226" x2="364" y2="240"/></g>'
    // BL — chef hat + fork & spoon
    + '<g stroke="#2f9e44" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round">'
    +   '<path d="M165 320 a20 20 0 1 1 40 0 a15 15 0 1 1 -8 -27 a17 17 0 0 1 -24 0 a15 15 0 1 1 -8 27 Z"/>'
    +   '<line x1="168" y1="320" x2="202" y2="320"/>'
    +   '<line x1="150" y1="352" x2="150" y2="380"/><path d="M144 352 v-14 M150 352 v-14 M156 352 v-14"/>'
    +   '<path d="M178 352 v28 M172 338 a6 10 0 0 1 12 0 v6 a6 8 0 0 1 -12 0 Z"/></g>'
    // BR — power / circular saw
    + '<g stroke="#2f9e44" stroke-width="6" fill="none" stroke-linejoin="round" stroke-linecap="round">'
    +   '<circle cx="322" cy="338" r="24"/><circle cx="322" cy="338" r="5" fill="#2f9e44"/>'
    +   '<path d="M346 322 h22 a6 6 0 0 1 6 6 v20 a6 6 0 0 1 -6 6 h-20"/>'
    +   '<path d="M298 356 l-16 10"/></g>'
    // banner
    + '<g>'
    +   '<path d="M92 430 l-30 -14 l12 20 l-12 8 l150 20 Z" fill="#2f9e44"/>'
    +   '<path d="M408 430 l30 -14 l-12 20 l12 8 l-150 20 Z" fill="#2f9e44"/>'
    +   '<path d="M150 440 q100 -22 200 0 l-6 30 q-94 -20 -188 0 Z" fill="#2f9e44"/>'
    +   '<text x="250" y="463" text-anchor="middle" font-family="Georgia, serif" font-size="13" font-style="italic" fill="#ffffff" textLength="184" lengthAdjust="spacingAndGlyphs">EMPOWERING COMMUNITIES · YHWH</text>'
    + '</g>'
    + '</svg>';

  /* ----------------------------------------------- CESTIS Technical Services */
  var TECHNICAL = '<svg viewBox="0 0 700 400" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="CESTIS Technical Services Ltd">'
    + '<rect x="34" y="20" width="300" height="300" fill="#e5342b"/>'
    + '<rect x="356" y="92" width="300" height="176" fill="#1e50a0"/>'
    + '<text x="184" y="238" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="168" fill="#111111" text-anchor="middle" textLength="300" lengthAdjust="spacingAndGlyphs">CES</text>'
    + '<text x="506" y="232" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="150" fill="#ffffff" text-anchor="middle" textLength="290" lengthAdjust="spacingAndGlyphs">TIS</text>'
    + '<text x="350" y="382" font-family="Arial, sans-serif" font-weight="700" font-size="52" fill="#111111" text-anchor="middle" textLength="640" lengthAdjust="spacingAndGlyphs">TECHNICAL SERVICES  LTD</text>'
    + '</svg>';

  /* --------------------------------------------------------- HEART / NSTA */
  function figure(x, fill) {
    return '<circle cx="' + x + '" cy="18" r="9" fill="' + fill + '"/>'
         + '<path d="M' + (x - 13) + ' 46 a13 15 0 0 1 26 0 Z" fill="' + fill + '"/>';
  }
  var HEART = '<svg viewBox="0 0 220 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="HEART/NSTA Trust">'
    + '<g>' + figure(40, '#1f7fd0') + figure(80, '#1f7fd0') + figure(120, '#1f7fd0') + figure(160, '#1f7fd0') + '</g>'
    + '<rect x="26" y="60" width="168" height="46" rx="7" fill="#1f7fd0"/>'
    + '<text x="110" y="94" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#ffffff" text-anchor="middle" letter-spacing="1">HEART</text>'
    + '<text x="110" y="132" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="30" fill="#1f7fd0" text-anchor="middle" letter-spacing="3">NSTA</text>'
    + '<text x="110" y="148" font-family="Arial, sans-serif" font-weight="700" font-size="11" fill="#1f7fd0" text-anchor="middle" letter-spacing="4">TRUST</text>'
    + '</svg>';

  root.FINANCE_LOGOS = { shield: CREST, technical: TECHNICAL, heart: HEART };

})(typeof window !== 'undefined' ? window : this);
