# Pilot study kits: what an instructor should check

The three pilot kits are marked `"status": "to-check"`. Staff see "Not yet
checked" on them until an instructor has read them through. Each kit's
figures that vary by maker or job are written as typical, with "follow the
manufacturer's instructions and your instructor". The points below are the
ones the writers were least sure of.

## Welding: MEMFAB0111C (MMAW)

- Filter shades by current: 9 up to 40 A, 10 for 40–80 A, 11 for 80–175 A,
  12 for 175–300 A, 13 for 300–500 A (from the EN 169 chart).
- E6013 currents by size: 2.0 mm 40–70 A, 2.5 mm 50–90 A, 3.2 mm 90–130 A,
  4.0 mm 120–180 A, 5.0 mm 180–250 A.
- E7018: holding oven about 120–150 °C; re-bake about 350 °C for 1–2 hours.
- Fire watch: "at least 30 minutes (many ask for an hour)".
- Open-circuit voltage about 50–90 V; arc voltage about 20–30 V. The advice
  to leave the machine running when the overheat light comes on should be
  checked against the Centre's own machines.
- Technique figures: bead width, restart distance, tack length, single-V
  preparation (60°, 1–2 mm root face, 2–3 mm gap), lap fillet angle about 45°.

## Electrical: EEMELS0011B (basic electrical safety)

- Emergency numbers: 110 fire and ambulance, 119 police.
- Inspection: the kit says the Government Electrical Regulator (GER)
  replaced the Government Electrical Inspectorate (Electricity Act 2015),
  and licensed inspectors certify before JPS connects.
- The code in use is described as based on the US NEC (NFPA 70).
- Overhead lines: 3 m (10 ft) for lines up to 50 kV (the US OSHA rule), with
  "follow JPS and your supervisor"; fallen lines: "at least 10 m".
- GFCI about 5 mA, RCD 30 mA; current-effect ranges are approximate.
- Burns: cool under running water for about 20 minutes, then a clean dry
  dressing (the exam's model answer mentions only the dressing).

## Cosmetology: CSBCOS0031C (shampooing and conditioning)

- The exam bank contradicts itself on friction massage (T2-E04 and T2-E10):
  the marking guide needs reconciling. The kit teaches friction as brisk
  rubbing and advises lighter massage on an oily scalp.
- Typical figures: disinfectant contact 10 minutes, towels at 60 °C,
  rinse-out conditioner 1–5 minutes, deep treatment 10–30 minutes.
- pH: conditioners about 3.5–6; soap and permanent colour about 8–11; most
  relaxers 12–14. "Most relaxers go on an unwashed scalp": check against
  the brands the Centre uses.
- Head lice: refer the client to a pharmacist or doctor.
- Jamaica: hard water in limestone areas; data protection for client
  records; a sample price of JMD 2,200.

When a kit has been checked, change its `"status"` to `"ready"` and run
`node tools/build-study-kit-index.js`.
