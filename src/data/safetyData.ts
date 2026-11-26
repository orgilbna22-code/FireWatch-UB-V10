export interface SafetyStep {
  step: number;
  actionMn: string;
  actionEn: string;
  detailsMn: string;
  detailsEn: string;
}

export interface SafetyGuide {
  id: string;
  topicNumber: string;
  titleMn: string;
  titleEn: string;
  summaryMn: string;
  summaryEn: string;
  keySteps: SafetyStep[];
  criticalRulesMn: string[];
  criticalRulesEn: string[];
  officialSourceMn: string;
  officialSourceEn: string;
}

export const SAFETY_GUIDES: SafetyGuide[] = [
  {
    id: 'guide-ger',
    topicNumber: '01',
    titleMn: 'Гэр хороолол, зуух, яндан ба үнс нурмын аюулгүй байдал',
    titleEn: 'Ger, Stove, Flue Pipe & Hot Ash Safety',
    summaryMn:
      'Өвөл болон хаврын халаалтын улиралд гэрийн эсгий бүрээс, яндангийн тусгаарлалт болон халуун үнсний хадгалалтаас үүдэх галаас сэргийлэх үндсэн алхмууд.',
    summaryEn:
      'Core winter and spring heating-season precautions covering stove clearance, roof flue insulation collars, and sealed metal ash bins.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Халуун үнс, нурмыг зөвхөн таглаатай төмөр саванд хийх',
        actionEn: 'Store hot ash strictly inside a lidded metal container',
        detailsMn:
          'Үнс хүйтэн мэт харагдавч дотор нь 24–48 цаг цог хадгалагддаг. Модон хайрцаг, хуванцар хувин эсвэл ил газар хашааны ёроолд асгаж болохгүй.',
        detailsEn:
          'Embers can stay active inside ash for 24–48 hours. Never dump warm ash into plastic bins, cardboard boxes, or dry yard corners.',
      },
      {
        step: 2,
        actionMn: 'Яндангийн цоорхой, тоононы тусгаарлагчийг шалгах',
        actionEn: 'Inspect flue pipe joints and roof-ring heat shielding',
        detailsMn:
          'Яндан тооно, эсгийтэй хүрэлцэх хэсэгт шатдаггүй металл эсвэл асбестгүй галд тэсвэртэй жийргэвч заавал хийнэ.',
        detailsEn:
          'Keep non-combustible metal collars around the chimney exit at the roof crown and seal any loose smoke pipe seams.',
      },
      {
        step: 3,
        actionMn: 'Зуухны урд галд тэсвэртэй төмөр хавтан байрлуулах',
        actionEn: 'Place a non-combustible metal hearth sheet under the stove',
        detailsMn:
          'Гэрийн шалнаас зуух руу оч унах эрсдэлийг хаахын тулд зуухны амны өмнө дор хаяж 50 см цухуйсан төмөр дэвсгэр тавина.',
        detailsEn:
          'Install a sheet-metal floor protector extending at least 50 cm in front of the stove door and keep firewood 1+ meter away.',
      },
    ],
    criticalRulesMn: [
      'Бага насны хүүхдийг галтай зуухтай гэрт цоожилж орхихгүй байх.',
      'Салхи шуургатай шөнө ил задгай үнс асгахыг хориглоно.',
      'Нүүрсний угаарын хийн дохиолол (CO detector)-ийн зайг сар бүр шалгах.',
    ],
    criticalRulesEn: [
      'Never leave young children locked alone inside a heated ger or house.',
      'Never dump ashes outdoors during high-wind gusts.',
      'Test carbon monoxide & smoke detector batteries monthly.',
    ],
    officialSourceMn: 'Гал түймрээс урьдчилан сэргийлэх ерөнхий зөвлөмж (101 / 105)',
    officialSourceEn: 'General Residential Fire Prevention Reference (101 / 105)',
  },
  {
    id: 'guide-electrical',
    topicNumber: '02',
    titleMn: 'Цахилгааны хэт ачаалал ба богино холболт',
    titleEn: 'Winter Electrical Load & Short-Circuit Prevention',
    summaryMn:
      'Хүйтний улиралд цахилгаан халаагуур, олон залгуур (extension) давхарлан ашигласнаас үүсэх утсан шаталтыг зогсоох зөвлөмж.',
    summaryEn:
      'Preventing overloaded extension cords, space-heater fires, and faulty breaker trips during peak winter cold.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Цахилгаан халаагуурыг уртасгагчид бус шууд розеткад залгах',
        actionEn: 'Plug space heaters directly into wall outlets—never power strips',
        detailsMn:
          '2 кВт-аас дээш чадалтай халаагуур нь энгийн уртасгагчийн утсыг хайлуулж далд гал үүсгэдэг.',
        detailsEn:
          'High-wattage space heaters overheat thin power strips and coiled extension cords, leading to hidden ignition behind furniture.',
      },
      {
        step: 2,
        actionMn: 'Халаалтын төхөөрөмжөөс 1 метр зайд шатах зүйлгүй байлгах',
        actionEn: 'Maintain a 1-meter clear radius around all electric heaters',
        detailsMn:
          'Хөшиг, ор хөнжил, хувцас хатаагчийг халаагуурын ойролцоо болон дээр нь тавихыг хатуу хориглоно.',
        detailsEn:
          'Keep curtains, bedding, furniture, and drying clothes well clear of heating elements.',
      },
      {
        step: 3,
        actionMn: 'Автомат гал хамгаалагч болон залгуурын халалтыг шалгах',
        actionEn: 'Replace warm outlets, flickering switches, and taped wires',
        detailsMn:
          'Залгуур халуун оргих, хуванцар үнэртэх, гэрэл анивчих нь контакт суларсны шинж тул мэргэжлийн цахилгаанчнаар засуулна.',
        detailsEn:
          'Warm wall plates or faint burnt plastic smells indicate arcing connections—shut off the breaker and repair promptly.',
      },
    ],
    criticalRulesMn: [
      'Зориулалтын бус гал хамгаалагч (нарийн зэс утас ороох) ашиглахгүй.',
      'Шөнө унтах болон гэрээс гарахдаа цахилгаан халаагуурыг унтраана.',
      'Гар утас, цэнэглэгчийг дэр хөнжил доор цэнэглэхгүй.',
    ],
    criticalRulesEn: [
      'Never bypass circuit breakers with improvised copper wire.',
      'Turn off portable heaters before sleeping or leaving home.',
      'Do not charge phones or battery packs under pillows or bedding.',
    ],
    officialSourceMn: 'Ахуйн цахилгааны галын аюулгүйн санамж',
    officialSourceEn: 'Household Electrical Fire Safety Guidance',
  },
  {
    id: 'guide-apartments',
    topicNumber: '03',
    titleMn: 'Орон сууц, орц, цахилгаан самбар ба утааны гарц',
    titleEn: 'Apartment Stairwells, Risers & Smoke Evacuation',
    summaryMn:
      'Олон давхар барилгын орц, шатны хонгилд утаа тархах үед авах арга хэмжээ ба галын гарц чөлөөтэй байлгах стандарт.',
    summaryEn:
      'Keeping shared apartment corridors unobstructed and responding safely when stairwell smoke cuts off primary exits.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Орцны гарц болон гадна замд машин, тавилга хааж тавихгүй',
        actionEn: 'Keep stairwell landings and fire lanes completely clear',
        detailsMn:
          'Дугуй, хуучин тавилга болон орцны урд зам хаасан зогсоол нь галын машины шат байрлуулахад 5–10 минут алдуулдаг.',
        detailsEn:
          'Blocked hallways trap escaping residents, and double-parked cars delay ladder truck positioning at building facades.',
      },
      {
        step: 2,
        actionMn: 'Утаа орц дүүргэсэн бол лифт ашиглахгүй, доогуур мөлхөж гарах',
        actionEn: 'Never use elevators during a fire; crawl low under smoke',
        detailsMn:
          'Хорт утаа таазаар хуримтлагддаг тул шалаас 30 см орчим цэвэр агаар үлддэг. Нойтон алчуураар ам хамраа дарна.',
        detailsEn:
          'Elevators can lose power or open onto the fire floor. Stay below toxic smoke plumes and use enclosed fire stairs.',
      },
      {
        step: 3,
        actionMn: 'Хэрэв шат утаагаар дүүрсэн бол өрөөндөө үлдэж хаалгаа битүүмжлэх',
        actionEn: 'If stairs are smoke-logged, shelter in place and seal the door',
        detailsMn:
          'Хаалганы завсрыг нойтон даавуугаар битүүлж, тагт эсвэл цонхоор 101/105 руу яг давхар, орцоо хэлж дуудлага өгнө.',
        detailsEn:
          'Pack wet towels around door seams, signal rescuers from a window or balcony, and report your exact apartment number to 101/105.',
      },
    ],
    criticalRulesMn: [
      'Тагтан дээр шатах шингэн, хийн баллон, цаас хураахгүй байх.',
      'Утаа мэдрэгчийг гал тогооны хажууд бус унтлагын өрөөний өмнөх таазанд суурилуулах.',
      'Давхар бүрийн галын хоолойн шүүгээг түгжиж хаахгүй.',
    ],
    criticalRulesEn: [
      'Avoid storing flammable liquids or camping gas canisters on open balconies.',
      'Mount smoke alarms on ceilings near sleeping quarters.',
      'Do not lock or block shared floor fire-hose cabinets.',
    ],
    officialSourceMn: 'Орон сууцны барилгын галаас хамгаалах санамж',
    officialSourceEn: 'Multi-Unit Residential Fire Evacuation Guidance',
  },
  {
    id: 'guide-spring',
    topicNumber: '04',
    titleMn: 'Хавар, намрын хуурайшилт ба салхитай өдрийн гал түймэр',
    titleEn: 'Spring Dry Grass, Wind & Wildland-Urban Interface',
    summaryMn:
      '3–5 болон 9–10-р сард өвс ургамал хатсан, хүчтэй салхитай өдрүүдэд зуслан болон захын гэр хороололд гал хурдан тархахаас сэргийлэх.',
    summaryEn:
      'Preventing rapid wind-driven fire spread along dry grass corridors, dacha valleys, and peri-urban hillsides in spring and autumn.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Хашаа, зуслангийн эргэн тойрны өнжмөл өвсийг шатаалгүй цэвэрлэх',
        actionEn: 'Clear dry grass mechanically—never burn yard waste or stubble',
        detailsMn:
          'Улаанбаатарын хаврын салхи 30–50 км/ц хүрэхэд жижиг өвсний гал хэдхэн минутад хашаанаас хашаанд дамждаг.',
        detailsEn:
          'In 30–50 km/h spring gusts, small stubble burns rapidly jump fence lines into neighboring yards and hillsides.',
      },
      {
        step: 2,
        actionMn: 'Тамхины иш, ил галыг ой, ногоон бүсийн захад хаяхгүй байх',
        actionEn: 'Extinguish embers completely with water and soil',
        detailsMn:
          'Аялал зугаалга болон хашаа цэвэрлэгээний үед ил гал асаахгүй, цогийг усаар бүрэн унтраана.',
        detailsEn:
          'Avoid open fires during dry, windy forecasts; douse and stir any embers until cool to the touch.',
      },
      {
        step: 3,
        actionMn: 'Хашааны зурваст шатах материалгүй 2–3 м хамгаалалтын зай үлдээх',
        actionEn: 'Keep a 2–3m non-combustible perimeter around fences and sheds',
        detailsMn:
          'Түлээ, нүүрс, дугуй зэрэг амархан шатах зүйлсийг модон хашаанд тулгаж хураахгүй.',
        detailsEn:
          'Stack firewood, scrap lumber, and winter fuel away from boundary fences and outer walls.',
      },
    ],
    criticalRulesMn: [
      'Салхины анхааруулга (FWI өндөр) гарсан өдөр гагнуур, зүсэлтийн ажил гадаа хийхгүй.',
      'Ой хээрийн галын шинж (хяр дээрх утаа) ажиглагдвал нэн даруй 101/105 руу мэдэгдэнэ.',
    ],
    criticalRulesEn: [
      'Suspend outdoor welding or angle grinding on high-wind dry days.',
      'Report hillside smoke plumes immediately to 101 or 105 with clear landmarks.',
    ],
    officialSourceMn: 'Хавар-намрын хуурайшилтын үеийн урьдчилан сэргийлэлт',
    officialSourceEn: 'Dry-Season Wildland-Urban Interface Preparedness',
  },
  {
    id: 'guide-evacuation',
    topicNumber: '05',
    titleMn: 'Өрхийн нүүлгэн шилжүүлэлтийн төлөвлөгөө ба уулзах цэг',
    titleEn: 'Family Evacuation Plan & Safe Meeting Point',
    summaryMn:
      'Галын дохиолол дуугарах эсвэл шөнийн утаа мэдрэгдэхэд гэр бүлийн бүх гишүүн сандралгүйгээр 2 минутад аюулгүй цэгт цуглах бэлтгэл.',
    summaryEn:
      'Ensuring every family member—especially children and elderly relatives—reaches a pre-agreed outdoor meeting point safely.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Хашаа эсвэл байрны гадна тодорхой нэг уулзах цэг тохирох',
        actionEn: 'Agree on one fixed outdoor meeting point away from danger',
        detailsMn:
          'Шөнийн цагт хэн нь гарсан эсэхийг шууд шалгахын тулд тогтсон гэрлийн шон, гудамжны эхлэл эсвэл хөршийн хашааны гадна цуглана.',
        detailsEn:
          'Pick a fixed landmark well clear of smoke and arriving fire trucks so everyone is accounted for immediately.',
      },
      {
        step: 2,
        actionMn: 'Хүүхэд, өндөр настанд түлхүүргүй онгойх гарцыг зааж өгөх',
        actionEn: 'Make sure exits open without searching for keys',
        detailsMn:
          'Аврах хаалга, гэр хашааны түгжээг гаднаас цоожилж болохгүй; гарах замыг бүрэн чөлөөтэй байлгана.',
        detailsEn:
          'Never padlock exits from the outside while people are inside; store flashlight and emergency shoes near beds.',
      },
      {
        step: 3,
        actionMn: 'Гал ассан барилга руу эд зүйл, бичиг баримт авахаар буцаж орохгүй',
        actionEn: 'Once outside, stay outside—never re-enter for belongings',
        detailsMn:
          'Нэгэнт аюулгүй гарсан бол дотор хүн үлдсэн эсэхийг аврах баг (101/105) ирмэгц нэн даруй мэдэгдэнэ.',
        detailsEn:
          'Report any trapped individuals to arriving firefighters immediately rather than going back inside.',
      },
    ],
    criticalRulesMn: [
      'Гал түймэр болон утааны үед эд хөрөнгөнөөс илүү хүний амь нас нэн тэргүүнд.',
      'Хүүхдэд 101 болон 105 дугаар, гэрийн хаяг хороогоо цээжлүүлэх.',
    ],
    criticalRulesEn: [
      'Life safety comes first—personal documents and possessions can be replaced.',
      'Teach children how to dial 101/105 and state their district and khoroo clearly.',
    ],
    officialSourceMn: 'Өрхийн бэлэн байдлын гарын авлага',
    officialSourceEn: 'Household Emergency Evacuation Checklist',
  },
  {
    id: 'guide-extinguisher',
    topicNumber: '06',
    titleMn: 'Анхан шатны гал унтраагуур (PASS дүрэм)',
    titleEn: 'Using a Portable Fire Extinguisher (PASS Method)',
    summaryMn:
      'Жижиг галыг эхний 60 секундэд аюулгүй унтраах дараалал болон хэзээ унтраах оролдлого хийхгүйгээр шууд гарах тухай.',
    summaryEn:
      'Safe operation of ABC dry-powder extinguishers on small incipient fires and recognizing when to evacuate immediately instead.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Нуруундаа гарах хаалга үлдээсний дараа PASS дарааллаар шүрших',
        actionEn: 'Keep your back to an exit and apply PASS: Pull, Aim, Squeeze, Sweep',
        detailsMn:
          'P — Түгжээг татах, A — Хошууг дөлийн уг руу чиглүүлэх, S — Бариулыг шахах, S — Баруун зүүн тийш шүүрдэх хөдөлгөөнөөр шүршинэ.',
        detailsEn:
          'Pull the safety pin, Aim the nozzle at the base of the flames, Squeeze the lever, and Sweep side to side from a safe distance.',
      },
      {
        step: 2,
        actionMn: 'Тос, цахилгааны галд хэзээ ч ус цацахгүй байх',
        actionEn: 'Never throw water on cooking oil or live electrical fires',
        detailsMn:
          'Халсан тосонд ус хийвэл гал огцом дэлбэрч цацрана; таглаа эсвэл галын бүтээлгээр агаарыг нь хаана.',
        detailsEn:
          'Smother pan grease fires with a metal lid or fire blanket, and cut power at the breaker if safe for electrical faults.',
      },
      {
        step: 3,
        actionMn: 'Даралтын заагч ногоон бүсэд байгаа эсэхийг 6 сар тутам шалгах',
        actionEn: 'Verify the pressure gauge sits in the green zone every 6 months',
        detailsMn:
          'Хүйтэн амбаарт удаан хадгалсан унтраагуурын даралт унасан эсэхийг шалгаж, хугацаа дууссан бол цэнэглүүлнэ.',
        detailsEn:
          'Confirm gauges sit in the green band and service expired units so they work when needed.',
      },
    ],
    criticalRulesMn: [
      'Гал таазанд хүрсэн эсвэл өрөө утаагаар дүүрсэн бол унтраах гэж оролдолгүй шууд гарч 101 залгана.',
    ],
    criticalRulesEn: [
      'If flames spread beyond a wastebasket size or smoke blocks visibility, evacuate immediately and call 101.',
    ],
    officialSourceMn: 'Анхан шатны гал унтраах хэрэгслийн заавар',
    officialSourceEn: 'Portable Fire Extinguisher Safety Reference',
  },
  {
    id: 'guide-reporting',
    topicNumber: '07',
    titleMn: '101 / 105 руу дуудлага өгөх ба галын машин тосох дараалал',
    titleEn: 'Calling 101 / 105 Clearly & Guiding Arriving Fire Units',
    summaryMn:
      'Шуурхай дуудлага өгөхөд шаардлагатай 4 мэдээлэл болон гэр хорооллын гудамжинд аврах ангийг хурдан оруулах арга.',
    summaryEn:
      'Communicating exact location details to dispatchers and guiding fire engines efficiently through narrow urban or ger-district alleys.',
    keySteps: [
      {
        step: 1,
        actionMn: 'Байршлаа дүүрэг, хороо, гудамж, тод тэмдэгтээр хэлэх',
        actionEn: 'State district, khoroo, street/building, and clear landmarks',
        detailsMn:
          'Ямар дүүрэг, хэддүгээр хороо, аль сургууль/дэлгүүрийн урд эсвэл орц хаалганы кодыг тайвнаар тодорхой хэлнэ.',
        detailsEn:
          'Give district, khoroo number, recognizable nearby landmarks, gate access codes, and whether anyone is trapped inside.',
      },
      {
        step: 2,
        actionMn: 'Гэр хороололд том уулзвар дээр угтах хүн зогсоох',
        actionEn: 'Post a family member or neighbor at the main junction to guide trucks',
        detailsMn:
          'Гудамжны дугаар арилсан, харанхуй эсвэл олон салаа замтай үед уулзвар дээр гар чийдэнтэй хүн тосох нь хэдэн минут хэмнэдэг.',
        detailsEn:
          'In unlit lanes or unmarked alleys, waving a phone light at the paved turnoff saves crucial minutes.',
      },
      {
        step: 3,
        actionMn: 'Утсаа оператор таслах хүртэл сандралгүйгээр мэдээлэл өгөх',
        actionEn: 'Stay on the line until the dispatcher confirms all details',
        detailsMn:
          'Утас таслахаас өмнө эргэж холбогдох дугаараа шалгаж баталгаажуулна.',
        detailsEn:
          'Confirm your callback number and answer safety questions about trapped people or gas/chemical hazards.',
      },
    ],
    criticalRulesMn: [
      'Хуурамч дуудлага өгөх нь бодит хүний амь аврах хугацаанаас хумсалдаг тул хуулиар хориглоно.',
      'Ажиллах дугаарууд: Гал команд 101 · Онцгой байдал 105 · Цагдаа 102 · Түргэн 103.',
    ],
    criticalRulesEn: [
      'Emergency numbers in Mongolia: 101 (Fire) · 105 (NEMA Rescue) · 102 (Police) · 103 (Ambulance).',
      'False emergency calls endanger real lives and carry legal penalties.',
    ],
    officialSourceMn: 'Онцгой байдлын албаны дуудлага хүлээн авах стандарт санамж',
    officialSourceEn: 'Emergency Dispatch Communication Standard Reference',
  },
];
