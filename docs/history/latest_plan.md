# Implementation Plan - Member Withdrawal Cleanup (Hong Seul-gi)

Removing all records related to "Hong Seul-gi" (홍슬기) who has withdrawn from the club.

## Proposed Changes

### [Data Cleanup]

#### [MODIFY] [sync_members.js](file:///c:/Users/%EC%84%AD%EC%9D%B4/Desktop/AI/teyeon-v2/scripts/sync_members.js)
- Remove the following entry: `{ n: '홍슬기', r: '정회원', p: '010-6444-9222' }`.

## Execution Steps

1. **Modify Master Script**: Remove Hong Seul-gi from the `OFFICIAL_MEMBERS` array.
2. **Execute Sync Pulse**: Run `node scripts/sync_members.js`. 
   - The script will detect "홍슬기" as an unlisted member and trigger a `DELETE` command to Supabase.
3. **Database Dependency Check**:
   - If the deletion fails due to foreign key constraints (e.g., in `matches` or `ranking`), I will investigate the impact.
   - Typically, for withdrawn members, we either hard-delete (standard for this system's sync logic) or keep historical data. Given the "reflect in all menus" request, complete removal is the target.

## Verification Plan

### Manual Verification
- **Run Sync Script**: Confirm console output shows `❌ Deleting unlisted: 홍슬기`.
- **Final Count**: Verify total member count drops from 25 to 24.
- **Frontend Verification**: (Mental Check) Since the frontend fetches from the `members` table, Hong Seul-gi will automatically disappear from the Ranking, Attendance, and Matchmaking menus.
