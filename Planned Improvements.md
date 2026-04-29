
## General Improvements
1. Views need to look ok when the screen size is half of full width. Rows should have certain columns omitted at this width to fit properly, stuff should still look clean. Some pages are better than otthers. All should be reviewed but pages that don't look good:
	- Shows list
	- Add a show
	- Discover
	- Map (header)
2. MusicBrainz (high priority) - what are we using these ids for? Where are they stored?
3. Ingestion for regions - limit should be increased from 100 to 1000. Verify that we are properly deduping ticketmaster venue ids and/or google place ids.  
4. In compact view, There is a button that directs to /me but that gives 404. It should go to preferences instead. Alos instead of add button in the middle that should open a dropdown to get to the other pages (discvoer, vneues, artists, etc. )
5. A few of these pages take a long time to load. When I click on different pages, it takes a while for anything to respond and it feels like a sluggish UX. Can we go to the page quicker and have a frame that shows while APIs are loading? 
6. In general, I want to see if we can improve the UX with freindlier imagery and layouts here. I want suggestions on where to improve this. 
7. Photo and video support? Uploading photos to the system for different shows - what would that take? 
	1. Id want the photos for shows at a specific venue to all be displayed on venue detail page. Same with artist images grouped on artist detail page. 
	2. If I have longer videos - how to best handle that and not pay money to store? Keep in google drive? Investigate options how videos can still be played back inline in the app. 
8. Notes support for shows. 
9. Security audit
10. Langfuse integration for observability
11. Better structured logging
12. Emai notifications - what do we need to enable that for free? What do we need email content to look like? It should be functional but also look sleek and modern. 
13. Critical code smells

## Home Page

1. Remove Godo evening and date from header. Replace with some image or icon that would be appropriate there.
2. For stats on other side, remove spent. Alos venues should not have NYC. Make sure the other stats are wired up properly.
3. Venue details should be hyperlinked to venues for sub-hero cards
4. Artist detil page should be linked from recent rows. 
5. Clicking on recent rows anywhere else should go to show detail page.
6. If home is in empty state, there should be a friendly message and a button to improt from gmail that is already in the header of the shows list page. 


## Add a Show Page
1. We need to redesign this. Use UI/UX best practices. Import from seems logical to be at the top. The date should be near timeframe - the timeframe slector should update automatically between past and watching depending if the date is in the past or future. 
2. Playbill photos - what is this for? Should we have photo support in general from this page? Is that in addition to whatever this playbill photo feature is for?
3. Remove other headliners field - lineup will handle all performers. 

## Discover Page
1. On the lists on the leftside, I should be able to right click on the followed venue or followed artist and see an option to unfollow. Unfollowing should remove it server-side and update the current display. 
2. On the followed artists page, check if there is a ticketmaster API to search for artists. See if we can follow an artist this way and have a FOllow another artist button on the left list of this page. 
3. Near You tab should have the venues grouped by region. The region header should be able to be rlght clicked to see an option to unfollow. Unfollowing should remove it server-side and update the current display. The announcements should only be removed if they arent for existing followed venues or artists. 
4. Remove the hyperlink to nothing on the rows.


## Venue Details Page
1. TM linked venues do not need scrape config section on this page. 
2. If we follow a venue and the venue does not have a google place id yet, we should attempt to search and set one. If this came from ticketmaster ingestion via discover page, we don't have a google place id yet. 
3. Unfollowing a venue that doesn't have any attended shows where the venue is deleted gives no visual indication. When refreshed, the page shows venue no longer exists error. In this case, we should redirect to venues list page. 
4. View on map should take to the map view (it does) WITH the side panel for this venue opened and zoomed in to the lcoation on the map (it does not do this yet)

## Venues List Page
1. I should be able to right click on a row and see the following options:
	1. Rename (which should be an inline action)
	2. Follow (which should live update the icon on the row)
2. Paginate the table. Lets start with 15 in compact mode and 12 if not. 
3. State and City column should be swapped

## Shows List Page
1. I should be able to right click on a row and see the following options:
	1. Edit
	2. Delete
	3. Mark as attended (if state is TIX)
	4. Got tickets (if state is WATCHING)
	5. Ticketmaster (if ticketmasterUrl is populated)
2. Remove expanded view for a row sicne we're replacing with a context menu. Remove the arrow on the row. 
3.  Paginate the table. Lets start with 12 in compact mode and 10 if not. 
4. Calendar 
	1. Can we have a year view in additon to monthly view?
	2. The month switcher always says Today
	3. The bounds of the month switcher should be from the available show data
5. Stats
	1. The stats should update based on the time filter selection. They are currently stuck on all time regardless. 

## Artist List Page
1. I should be able to right click on a row and see the following options:
	1. Rename
	2. Delete 
	3. Mark as attended (if state is TIX)
	4. Got tickets (if state is WATCHING)
2. The three rightside columns need to be shifted left and spaced out more evently. 
3. Add a visual indicator to the end of the column for whether the artist is followed or not. Use the venue list page as an example. Also respace the columns after this addition. 
4. Paginate the table. Lets start with 15 in compact mode and 12 if not. 


### Map Page
1. Shortcuts in bottom right of map should be: Bay Area, LA, Oregon, NYC, and World
2. Remove watch upcoming from venue side panel - log a visit does the same thing.
3. Follow is not working properly from the venue side panel. I follow a venue, click discover and dont see it in followed venues. 

### Show Detail Page

1. Setlists should be stored in the DB as a dictionary of perform to setlist object. The add a show page should stay as it is, but the show detail page should show all of the setlists for the different artists. This should be displayed in an easy to consume way. Only one setlist at a time - switch between by artist picker. 


### Preferences
1. I should be able to set the digest time and discover digest through the UI (time is just a static string right now). This needs to be verified to be hooked up to a scheduled job. 
2. Remove the show-day remidner setting. 
3. Set a limit of five regions to track and have that be clear in the UI. 
4. Paginate the followed venues so it doesnt take up the whole page. 10 at a time. 
5. Remove wikipedia from data sources at bottom. 


### Mobile App
1. We have some hifi designs of mobile app thorugh claude design, but we need to do a deep dive on an design for the mobile app now that we've added more features.
2. Hook up push notitfications in preferences page to mobile app once done


### Data Model Questions
1. Do we allow venues to be deleted? Or just let them automatically be deleted through triggers and cascades when shows and artists are deleted?
2. Similar to the above, when a show, venue, or artist is deleted and/or unfollowed or followed - what are the affected tables that are impacted?

