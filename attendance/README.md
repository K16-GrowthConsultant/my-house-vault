# Office Attendance

Employees punch in and out on one shared office device (a tablet or PC at the entrance). The app builds a monthly attendance register you can export. It works offline, and all data stays in that device's browser.

## Run it
- Host the `attendance/` folder on any static web host (GitHub Pages, Netlify, etc.) and open `index.html` on the office device. You can then install it as an app ("Add to Home screen" or "Install").
- To try it locally, run `python3 -m http.server` inside `attendance/` and open http://localhost:8000.

## How it works
1. **First run:** enter the company name and an admin PIN, then add employees, each with a 4-digit PIN.
2. **Punch screen:** the employee taps their name and enters their PIN. The app then shows Punch IN or Punch OUT, whichever applies. Multiple in/out pairs a day are added together. A night shift that ends after midnight still counts on the day the shift started.
3. **Admin** (behind the admin PIN, locks itself after 5 minutes idle):
   - **Today:** who is in, who came late, who has not arrived yet.
   - **Monthly register:** a grid of employees by days. Tap a cell to correct punch times or mark paid leave or leave without pay. Every change is written to the change log.
   - **Exports:** register CSV (day codes plus totals and payable days), punch log CSV, and print.
   - **Settings:** start time, grace minutes, full-day and half-day hours, weekly offs, holidays, and how a missing punch-out is counted.
   - **Backup:** download or restore a JSON file.

## Rules (editable in Settings)
| Code | Meaning | Payable |
|---|---|---|
| P | worked ≥ full-day hours | 1 |
| HD | worked ≥ half-day hours | 0.5 |
| A | absent or worked less than half-day hours | 0 |
| MP | punched in, never punched out | 0.5 by default (setting) |
| L / LWP | paid leave / leave without pay | 1 / 0 |
| WO / H | weekly off / holiday | 1 |

Late = the first punch-in came after start time + grace minutes.

## Limits to know
- **Data lives on one device only.** Clearing browser data, resetting the device or uninstalling the app deletes the records. Download a backup every week and before each payroll.
- **Not tamper-proof.** Times come from the device clock, and someone with access to the browser developer tools could edit the stored data. The PINs and the change log stop casual buddy-punching, not a determined insider. If you need multiple branches, mobile punching with GPS, selfies, or tamper-proof records, you will need a server-backed version.
