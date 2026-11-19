# FIREWATCH UB — User Research & Usability Observation Protocol

> **Note:** This document is a **research protocol template only**. No usability sessions have been conducted yet; zero participant quotes, sample counts, or satisfaction percentages are claimed or fabricated.

---

## 1. Purpose & Ethics Rules

- Evaluate whether Ulaanbaatar citizens (primarily on mobile) and Fire Command duty officers can find accurate answers quickly **without misinterpreting demo/modelled numbers as official dispatch alerts**.
- **Privacy rule:** Do not collect full names, home addresses, national ID numbers, or phone numbers in session notes. Assign anonymized participant codes (`C01`, `FC01`, `P01`).

---

## 2. Citizen Observation Protocol (Mobile Priority, 5–8 Minutes)

### Core Task Prompt
> *"Та Улаанбаатар хотын Баянзүрх дүүргийн өөрийн хорооны галын эрсдэл ямар байгаа болон өнөөдөр юу хийх ёстойг 30 секундийн дотор олж хараад үзнэ үү."*
> ("In under 30 seconds on your phone, check the fire risk index for your khoroo in Bayanzurkh and identify 3 steps to take today.")

### Observation Checklist
- [ ] **Entry clarity:** Did the user understand the 3 audience cards (`Иргэн`, `Гал команд`, `Цагдаа`) without hesitation?
- [ ] **Lookup friction:** Could they select District + Khoroo smoothly in `CitizenRiskLookup`?
- [ ] **Honesty comprehension:** When asked *"Энэ тоо (жишээ нь 78/100) ямар утгатай вэ?"*, did they understand it is an informational index (demo/modelled) rather than a guaranteed emergency alert?
- [ ] **Actionability:** Could they locate the persistent `105` call button and `#personal` home audit link?

---

## 3. Fire Command Officer Protocol (Desktop, 5–10 Minutes)

### Core Task Prompt
> *"Өгөгдлийн удирдлага хэсгээс импортолсон болон жишээ өгөгдөл хэрхэн ялгарч харагдаж байгааг шалгаад, нэг дүүргийн тайлан CSV хэлбэрээр татаж үзнэ үү."*

### Observation Checklist
- [ ] **Data trust:** Does the officer immediately distinguish `LIVE` Open-Meteo telemetry from `DEMO / MODELLED` static spatial baselines?
- [ ] **Batch import workflow:** Can an analyst locate `docs/DATA_IMPORT.md` schema rules and readiness checks (`missingCoordsCount`, `unknownCauseCount`)?
- [ ] **Export safety:** Does the CSV / PDF warning banner make clear the report contains demo/modelled baselines?

---

## 4. Interview Questions (Mongolian & English)

1. **Эхний сэтгэгдэл:** Нүүр хуудсыг нээхэд юу хийх ёстой нь шууд ойлгогдсон уу? Ямар хэсэг эргэлзээ төрүүлсэн бэ? *(First impression: was it clear what to do first? What felt confusing?)*
2. **Тоон ойлголт:** "Эрсдэлийн индекс X/100" гэсэн үзүүлэлтийг хараад та юу гэж ойлгосон бэ? *(What did "risk index X/100" mean to you?)*
3. **Арга хэмжээ:** Өгсөн 3 зөвлөгөө таны амьдарч буй нөхцөлд (гэр хороолол / орон сууц) бодитоор хэрэгжүүлэх боломжтой юу? *(Are the 3 prevention steps practical for your housing type?)*
4. **Газрын зураг:** Газрын зураг дээрх өнгө, давхаргууд хэт их эсвэл уншихад төвөгтэй санагдсан уу? *(Did the map colors/overlays feel clean or cluttered?)*
5. **Итгэлцэл (Гал команд):** Системд ямар бодит эх сурвалж нэмбэл өдөр тутмын ажилд ашиглах боломжтой вэ? *(What real agency data would be required for operational trust?)*
6. **Цагдаагийн хэрэгцээ:** Гал түймрийн үед цагдаагийн нэгжид хамгийн хэрэгтэй мэдээлэл юу байдаг вэ? *(For police liaison: what incident perimeter/traffic info would actually be useful?)*
7. **Санал хүсэлт:** Хамгийн их засварлах эсвэл хасах шаардлагатай нэг зүйлийг нэрлэнэ үү. *(Name one thing that should be simplified or removed.)*

---

## 5. Session Scoring Rubric

| Rating | Meaning | Action Trigger |
| :--- | :--- | :--- |
| **Pass** | Task completed in < 30s (citizen) / < 3m (officer) without hints, correct interpretation of demo/modelled label. | Keep design |
| **Friction** | Needed hesitation, wrong tap, or confused jargon, then recovered. | Copy/hierarchy revision |
| **Blocked** | Could not locate control, misread score as real dispatch warning, or hit horizontal overflow/overlap. | Immediate P0 fix |
