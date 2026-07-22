# GridWatch ⇄ Citizens Action Coalition — dataset reconciliation

_2026-07-22 · GridWatch Indiana (47 records) vs CAC's published tracker (58 records)_

Both datasets are geocoded, so records were matched by proximity first and name second. Nothing below has been auto-merged — every disagreement needs a filing behind it before either side moves.

**21 agree · 20 disagree · 17 only in CAC's · 6 only in GridWatch's**


## 1. Corrections I made to my own data because of yours

Your coordinates caught two county errors on my side. Both confirmed independently by point-in-polygon against the Census county boundaries:

| Record | I had | Correct | Confirmed by |
|---|---|---|---|
| Unnamed — Dale | Dubois County | **Spencer County** | Dale is in Spencer; your coords; Census PIP |
| Unnamed — McCordsville | Hamilton County | **Hancock County** | McCordsville is in Hancock; your coords; Census PIP |

I've since added a standing check that flags any record whose stated county doesn't contain its own coordinates.


## 2. In your tracker, not in mine — I'm researching these

| Project | Owner | Location | MW | Status |
|---|---|---|---|---|
| Heartland Industrial Park - Sullivan | Heartland Development | Sullivan, Sullivan | 1580 | proposed |
| Project Raider - Vanderburgh | Unnamed | Evansville, Vanderburgh | 600 | proposed |
| Microsoft - La Porte #1 | Microsoft | La Porte, LaPorte | 538 | construction |
| Outrigger Industrial - Washington | Outrigger Industrial | Washington, Davies | 500 | withdrawn |
| Decennial Group - Akron | Decennial Group | Akron, Fulton | 500 | proposed |
| DC Blox - Indianapolis | DC Blox | Indianapolis, Marion | 78 | proposed |
| RadiusDC - Plainfield | RadiusDC | Plainfield, Hendricks | 24 | proposed |
| DartPoints - Columbus | DartPoints | Columbus, Indiana | 10 | operational |
| American Tower - Indianapolis | American Tower | Indianapolis, Marion | 4 | withdrawn |
| Unnamed - McCordsville | Unnamed | McCordsville, Hancock | — | rumored |
| Unnamed - Kokomo | Unnamed | Kokomo, Howard | — | proposed |
| Prologis - Leesburg | Prologis | Leesburg, Kosciusko | — | withdrawn |
| Wylie Capital - Merrillville | Wylie Capital | Merrillville, Lake | — | proposed |
| Thomas Rose Industrial Park - La Porte | Thomas Rose Industrial Park | La Porte, LaPorte | — | rumored |
| QTS - Jeremiah A | QTS | Wheeler, Porter | — | withdrawn |
| QTS - Jeremiah B | QTS | Wheeler, Porter | — | withdrawn |
| Western Hospitality Partners - South Bend | Western Hospitality Partners | South Bend, St. Joseph | — | rumored |


## 3. In mine, not in yours — you may want these

| Project | Location | MW | Status | Source |
|---|---|---|---|---|
| Unnamed Data Center (Gibson/Posey) | Princeton area, Gibson | 600 | proposed | https://ailawtracker.org/data-centers |
| QTS Jeremiah Campus (Withdrawn) | Benton County, Benton | — | withdrawn | https://ailawtracker.org/data-centers |
| Unnamed Data Center (New Carlisle) | New Carlisle, St. Joseph | — | proposed | https://ailawtracker.org/data-centers |
| Surge Greenfield MegaSite (Withdrawn) | Greenfield, Hancock | — | withdrawn | https://ailawtracker.org/data-centers |
| Project Shirley (Sentinel · Lowell) | Lowell, Lake | 500 | rumored | https://nwitimes.com/news/local/lake/article_bda889b5-f6ef-4e83-9ae4-5000ec293f09.html |
| Logix Realty / Clinton County (denied) | Frankfort, Clinton | — | withdrawn | https://www.datacenterdynamics.com/en/news/logix-realty-indiana-development-denied-due-to-community-concerns-and-developer-red-flags/ |


## 4. Where we disagree

These are the useful ones. I'm working each against IURC filings and will send you what I find.

| Record | Field | GridWatch | CAC |
|---|---|---|---|
| abei-knox | status | rumored | withdrawn |
| amazon-portage | status | proposed | withdrawn |
| dale-unnamed | status | proposed | withdrawn |
| digital-crossroads-hammond | status | proposed | construction |
| google-monrovia | status | approved | construction |
| hobart-devco | mw | None | 450.0 |
| mccordsville-rumored | status | rumored | withdrawn |
| merom-sullivan-withdrawn | mw | 1580 | 430.0 |
| merom-sullivan-withdrawn | status | withdrawn | proposed |
| meta-leap-lebanon | mw | 1540 | 1000.0 |
| microsoft-granger | status | proposed | construction |
| microsoft-laporte | status | construction | proposed |
| phoenix-michigan-city | mw | None | 300.0 |
| powerhouse-hobart | status | proposed | operational |
| powerhouse-hobart | county | Lake | Porter |
| prologis-shelbyville | mw | None | 900.0 |
| prologis-shelbyville | status | withdrawn | proposed |
| sabey-decatur | status | approved | proposed |
| sentinel-hebron | status | rumored | proposed |
| sentinel-hebron | county | Porter | Lake |
| surge-knightstown | status | rumored | proposed |
| takanock-goshen | status | rumored | proposed |
| wheatfield-rumored | mw | None | 800.0 |
| wheatfield-rumored | status | rumored | proposed |
| wylie-hobart | mw | None | 1500.0 |


---

GridWatch Indiana is a free, open-source, nonpartisan atlas: every figure links to its filing, and the whole dataset is version-controlled JSON. Corrections in either direction are welcome.
