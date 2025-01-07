// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: brown; icon-glyph: magic;

document.getElementById("icsFile").addEventListener("change", handleFileSelect);

async function handleFileSelect(event) {
  const file = event.target.files[0];
  const output = document.getElementById("output");

  if (!file) {
    displayMessage("No file selected.", output);
    return;
  }

  // Read the content of the file
  const fileContent = await file.text();

  if (!fileContent) {
    displayMessage("File could not be read.", output);
    return;
  }

  displayMessage("File loaded successfully. Processing...", output);

  try {
    // Parse the ICS content
    const events = parseICS(fileContent);
    displayMessage(`Found ${events.length} events in the file.`, output);

    // Call your main processing function
    main(events, output);
  } catch (error) {
    displayMessage(`Error processing file: ${error.message}`, output);
  }
}

function parseICS(content) {
  const events = [];
  const lines = content.split("\n");
  let event = null;

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("BEGIN:VEVENT")) {
      event = {};
    } else if (line.startsWith("END:VEVENT")) {
      if (event) events.push(event);
      event = null;
    } else if (event) {
      if (line.startsWith("SUMMARY:")) {
        event.summary = line.replace("SUMMARY:", "").trim();
      } else if (line.startsWith("DTSTART")) {
        event.start = parseICSTime(line.replace(/.*:/, "").trim());
      } else if (line.startsWith("DTEND")) {
        event.end = parseICSTime(line.replace(/.*:/, "").trim());
      }
    }
  }

  return events;
}

function parseICSTime(icsTime) {
  const year = parseInt(icsTime.substring(0, 4));
  const month = parseInt(icsTime.substring(4, 6)) - 1;
  const day = parseInt(icsTime.substring(6, 8));
  const hour = parseInt(icsTime.substring(9, 11) || "0");
  const minute = parseInt(icsTime.substring(11, 13) || "0");
  return new Date(year, month, day, hour, minute);
}

function displayMessage(message, outputElement) {
  outputElement.textContent += message + "\n";
}

async function main(events, output) {
  displayMessage("Processing events...", output);

  for (const event of events) {
    displayMessage(`Event: ${event.summary}, Start: ${event.start}, End: ${event.end}`, output);
  }

  displayMessage("Processing complete.", output);
}

async function main() {
  try {
    console.log("스텝 1: .ics 파일 선택 시작");
    let filePicker = await DocumentPicker.open(["public.text", "public.data"]);
    if (!filePicker || filePicker.length === 0) {
      console.log("파일 선택 취소됨");
      return;
    }

    let filePath = filePicker[0];
    console.log("선택된 파일 경로:", filePath);

    let fm = FileManager.iCloud();
    if (!fm.isFileDownloaded(filePath)) {
      console.log("파일 다운로드 중...");
      await fm.downloadFileFromiCloud(filePath);
    }

    let fileContent = fm.readString(filePath);
    if (!fileContent) {
      console.log("파일 내용 읽기 실패");
      return;
    }

    console.log("파일 내용 읽기 성공");

    let events = parseICS(fileContent);
    if (events.length === 0) {
      console.log("이벤트를 찾을 수 없습니다.");
      return;
    }

    console.log(`${events.length}개의 이벤트를 발견했습니다.`);

    // 캘린더 선택
    let calendars = await Calendar.forEvents();
    let calendarNames = calendars.map(c => c.title);

    let selectedCalendarIndex = await showMenu("캘린더 선택", calendarNames);
    if (selectedCalendarIndex === null) {
      console.log("캘린더 선택이 취소되었습니다.");
      return;
    }

    let selectedCalendar = calendars[selectedCalendarIndex];
    console.log(`선택된 캘린더: ${selectedCalendar.title}`);

    // 기존 이벤트 삭제
    let now = new Date();
    let startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    let endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    console.log(`삭제 대상 이벤트 기간: ${startOfMonth} ~ ${endOfMonth}`);
    let existingEvents = await CalendarEvent.between(startOfMonth, endOfMonth, [selectedCalendar]);

    console.log(`기존 이벤트 ${existingEvents.length}개 발견`);
    for (let event of existingEvents) {
      await event.remove();
      console.log(`기존 이벤트 삭제됨: ${event.title}`);
    }

    console.log("기존 이벤트가 모두 삭제되었습니다.");

    // DO 이벤트 날짜 추출
    let doDates = new Set(
      events
        .filter(event => event.summary.startsWith("DO"))
        .map(event => {
          let doStart = new Date(event.start);
          doStart.setHours(doStart.getHours() + 9); // UTC+9로 변환
          return doStart.toISOString().split("T")[0];
        })
    );

    console.log("DO 이벤트가 있는 날짜 (한국 시간 기준):", [...doDates]);

    // DO가 있는 날 다른 이벤트 제거
    events = events.filter(event => {
      let eventDate = new Date(event.start);
      eventDate.setHours(eventDate.getHours() + 9); // UTC+9로 변환
      let eventDateString = eventDate.toISOString().split("T")[0];

      if (doDates.has(eventDateString) && !event.summary.startsWith("DO")) {
        console.log(`DO 날짜의 이벤트 제외됨: ${event.summary}`);
        return false; // 이벤트 제거
      }
      return true; // 이벤트 유지
    });

    // 같은 Report time 기간 내 중복 KE 이벤트 처리
    let reportTimeEvents = events.filter(event => event.summary.startsWith("Report time"));
    for (let reportEvent of reportTimeEvents) {
      let reportStart = new Date(reportEvent.start.getFullYear(), reportEvent.start.getMonth(), reportEvent.start.getDate(), 0, 0, 0);
      let reportEnd = new Date(reportEvent.end.getFullYear(), reportEvent.end.getMonth(), reportEvent.end.getDate(), 23, 59, 59);

      // 같은 Report time 기간 내 KE 이벤트 찾기
      let keEvents = events.filter(
        event =>
          event.summary.startsWith("KE") &&
          event.start >= reportStart &&
          event.start <= reportEnd
      );

      let uniqueKEEvents = {};
      for (let keEvent of keEvents) {
        if (!uniqueKEEvents[keEvent.summary]) {
          uniqueKEEvents[keEvent.summary] = [];
        }
        uniqueKEEvents[keEvent.summary].push(keEvent);
      }

      // 중복 KE 이벤트 중 뒤에 있는 것 삭제
      for (let keEventList of Object.values(uniqueKEEvents)) {
        if (keEventList.length > 1) {
          keEventList.sort((a, b) => a.start - b.start); // 시간 순으로 정렬
          for (let i = 1; i < keEventList.length; i++) {
            let index = events.indexOf(keEventList[i]);
            if (index > -1) {
              events.splice(index, 1);
              console.log(`중복 KE 이벤트 삭제됨: ${keEventList[i].summary}`);
            }
          }
        }
      }

      // Report time 이벤트 삭제
      let index = events.indexOf(reportEvent);
      if (index > -1) {
        events.splice(index, 1);
        console.log(`Report time 이벤트 삭제됨: ${reportEvent.summary}`);
      }
    }

    // 새로운 이벤트 추가
    for (let event of events) {
      // 제목 앞에 기본 이모티콘 추가
      if (event.summary.startsWith("KE")) {
        event.summary = `✈️ ${event.summary}`;

        // 조건 1: 'ICN -' 포함, 시작 시간이 01:20 ~ 08:35 사이
        if (
          event.summary.includes("ICN -") &&
          event.start &&
          event.start.getHours() * 100 + event.start.getMinutes() >= 120 &&
          event.start.getHours() * 100 + event.start.getMinutes() <= 835
        ) {
          event.summary = `🚗 ${event.summary}`; // 자동차 이모티콘 맨 앞에 추가
          console.log(`자동차 이모티콘 추가 (조건 1): ${event.summary}`);
        }

        // 조건 2: '- ICN' 포함, 끝나는 시간이 22:00 ~ 05:15 사이
        if (
          event.summary.includes("- ICN") &&
          event.end &&
          (
            (event.end.getHours() * 100 + event.end.getMinutes() >= 2200) || // 22:00 ~ 23:59
            (event.end.getHours() * 100 + event.end.getMinutes() <= 515)    // 00:00 ~ 05:15
          )
        ) {
          event.summary = event.summary.replace("✈️", "✈️ 🚗"); // 자동차 이모티콘 비행기 뒤에 추가
          console.log(`자동차 이모티콘 추가 (조건 2): ${event.summary}`);
        }        
        
        // 조건 3: 'GMP -' 포함, 국내선, 시작 시간이 06:00 ~ 07:15 사이
    if (
      event.summary.includes("GMP -") &&
      isDomesticFlight(event.summary) && // 국내선 확인 함수 사용
      event.start &&
      event.start.getHours() * 100 + event.start.getMinutes() >= 600 &&
      event.start.getHours() * 100 + event.start.getMinutes() <= 715
    ) {
      event.summary = `🚗 ${event.summary}`; // 자동차 이모티콘 맨 앞에 추가
      console.log(`자동차 이모티콘 추가 (조건 3 - 국내선): ${event.summary}`);
    }

    // 조건 4: 'GMP -' 포함, 국제선, 시작 시간이 06:00 ~ 07:45 사이
    if (
      event.summary.includes("GMP -") &&
      !isDomesticFlight(event.summary) && // 국제선 확인 (국내선이 아니면 국제선)
      event.start &&
      event.start.getHours() * 100 + event.start.getMinutes() >= 600 &&
      event.start.getHours() * 100 + event.start.getMinutes() <= 745
    ) {
      event.summary = `🚗 ${event.summary}`; // 자동차 이모티콘 맨 앞에 추가
      console.log(`자동차 이모티콘 추가 (조건 4 - 국제선): ${event.summary}`);
    }
        
      } else if (event.summary.startsWith("DO")) {
        event.summary = `🏠 ${event.summary}`;
      } else if (event.summary.includes("SBY")) {
        event.summary = `⏰ ${event.summary}`;
      }

      try {
        let iosEvent = new CalendarEvent();
        iosEvent.title = event.summary;

        if (event.isAllDay) {
          // 하루 종일 이벤트로 설정
          iosEvent.startDate = event.start;
          iosEvent.endDate = event.end || new Date(event.start.getTime() + 24 * 60 * 60 * 1000); // 기본 다음날 설정
          iosEvent.isAllDay = true;
        } else {
          iosEvent.startDate = event.start || new Date();
          iosEvent.endDate = event.end || new Date(new Date().getTime() + 3600000); // 기본 1시간
          iosEvent.isAllDay = false;
        }

        iosEvent.calendar = selectedCalendar;
        await iosEvent.save();
        console.log(`새 이벤트 추가됨: ${iosEvent.title}`);
      } catch (error) {
        console.error(`이벤트 추가 실패: ${event.summary}, 오류: ${error.message}`);
      }
    }

    console.log("모든 이벤트가 성공적으로 추가되었습니다.");
  } catch (error) {
    console.error("오류 발생:", error.message);
  }
}

function parseICS(content) {
  let events = [];
  let lines = content.split("\n");
  let event = null;

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith("BEGIN:VEVENT")) {
      event = {};
    } else if (line.startsWith("END:VEVENT")) {
      if (event) events.push(event);
      event = null;
    } else if (event) {
      if (line.startsWith("SUMMARY:")) {
        event.summary = line.replace("SUMMARY:", "").trim();
      } else if (line.startsWith("DTSTART;VALUE=DATE:")) {
        let dtStart = line.replace("DTSTART;VALUE=DATE:", "").trim();
        event.isAllDay = true;
        event.start = parseICSTime(dtStart, true);
      } else if (line.startsWith("DTEND;VALUE=DATE:")) {
        let dtEnd = line.replace("DTEND;VALUE=DATE:", "").trim();
        event.end = parseICSTime(dtEnd, true);
      } else if (line.startsWith("DTSTART:")) {
        event.start = parseICSTime(line.replace("DTSTART:", "").trim());
      } else if (line.startsWith("DTEND:")) {
        event.end = parseICSTime(line.replace("DTEND:", "").trim());
      }
    }
  }

  return events;
}

function parseICSTime(icsTime, isDateOnly = false) {
  if (!icsTime || icsTime.length < 8) return null;

  let year = parseInt(icsTime.substring(0, 4));
  let month = parseInt(icsTime.substring(4, 6)) - 1;
  let day = parseInt(icsTime.substring(6, 8));

  if (isDateOnly) {
    return new Date(year, month, day);
  }

  let hour = icsTime.length > 8 ? parseInt(icsTime.substring(9, 11)) : 0;
  let minute = icsTime.length > 8 ? parseInt(icsTime.substring(11, 13)) : 0;
  let second = icsTime.length > 8 ? parseInt(icsTime.substring(13, 15)) : 0;

  return new Date(year, month, day, hour, minute, second);
}

async function showMenu(title, options) {
  let alert = new Alert();
  alert.title = title;
  options.forEach(option => alert.addAction(option));
  alert.addCancelAction("취소");

  let index = await alert.presentSheet();
  return index === -1 ? null : index;
}

// 국내선 여부 확인 함수
function isDomesticFlight(summary) {
  // 국내 공항 코드 리스트
  const domesticAirports = [
    "CJU", "PUS", "TAE", "KWJ", "USN", "RSU", "HIN", "WJU", "YNY", 
    "KUV", "CJJ", "HMY", "JDG", "MPK"
  ];

  // 출발지와 도착지가 모두 국내 공항인지 확인
  let [departure, destination] = summary.split(" - ");
  return domesticAirports.includes(departure) && domesticAirports.includes(destination);
}
await main();
