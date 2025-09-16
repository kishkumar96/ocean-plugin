<a name="top">OceanExpert API v1</a>
========================
This is the complete documentation for the API v1 of OceanExpert.
In case you find any errors please send a mail to [bugs@oceanexpert.org](mailto:bugs@oceanexpert.org).

The OceanExpert API can be used to 
- retrieve information from OceanExpert in a machine to machine communication
- log in and use the OceanExpert credentials for SSO (e.g. [ODISCat](https://catalogue.odis.org)).
- create events

# Menu
- [Search](#search)
    - [General Search](#generalSeach) 
    - [Advanced Search](#advanced)
        - [Browse)](#browseSearch)
        - [Advanced](#advancedSearch)
- [Experts](#experts)    
- [Institutes](#institutes)    
- [Regions](#regions)    
- [Events](#events) 
    - [Update the participants lisf of an event](#updateEventParticipants)
    - [Create an event](#createEvent)
- [Documents](#documents)    
- [Groups](#groups)    
- [Reports](#reports)   
- [OceanExpert Login](#login)

[back to top](#top)

# <a name="search">Search</a>

## <a name="generalSearch">General Search </a>
TBD

## <a name="advanced">Advanced Search </a>

### <a name="browseSearch">Browse</a>

API to get the Basic Search (browse) results

| Url                                | Description                                                                                           |
|------------------------------------|-------------------------------------------------------------------------------------------------------|
| /api/v1/advancedSearch/search.json | search for expert(s)/event(s)/institute(s) where any of the fields contains the given searchword(s) |

### Parameters:
- query (query string)
- action = browse
- type (all, experts, institutes, events) only one type can be selected
- limit
- page

### Examples:

- search for  'peter' in the experts data (names, institutes, addresses...), will give back a (long) list of experts

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=peter](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=peter)

- search for 'pissierssens' in the experts data (names, institutes, addresses...), will give back a (short) list of experts

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=pissierssens](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=pissierssens)

- search for 'pissierssens' and 'peter' in the experts data (names, institutes, addresses...), will give back only one result

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=peter+pissierssens](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=experts&query=peter+pissierssens)

- search for institutes that contain 'vlaams', will give you back a (long) list of institutes

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=institutions&query=vlaams](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=institutions&query=vlaams)

- searching for both 'vlaams' and 'zee' will only give you back the info for [VLIZ](https://vliz.be)

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=institutions&query=vlaams+zee](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=institutions&query=vlaams+zee)

- searching for 'vlaams' in the events will give you a (long) list of events related to 'vlaams'

[https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=events&query=vlaams](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=browse&type=events&query=vlaams)

[back to top](#top)

### <a name="advancedSearch">Advanced Search</a>

API to get the advanced search results

| Url                                                                                                                                                                                                                                                                                                                                                                                                                          | Description                                                                                                                                                            |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [/api/v1/advancedSearch/search.json?action=advSearch&<br/>type[]=experts&<br/>filter[]=Name+contains&<br/>keywords[]=peter&<br/>toggle[]=AND&<br/>type[]=experts&<br/>filter[]=Email+contains&<br/>keywords[]=peter](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=experts&filter[]=Name+contains&keywords[]=peter&toggle[]=AND&type[]=experts&filter[]=Email+contains&keywords[]=peter) | find the first (default **page**=1) 10 (default **limit**=10) experts where the name contains 'peter' **and** (**toggle**=AND) the email address also contains 'peter' |

### Parameters:

***action*** = advSearch (for advanced search)

action should always be ***advSearch*** here

***keywords[]*** => any keywords in search related to the filter

#### Examples

| Url                                                                                                                                                                                                                                                    | Description                                                                                     |
|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| [api/v1/advancedSearch/search.json?action=advSearch&type[]=experts&filter[]=Name+contains&keywords[]=vliz](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=experts&filter[]=Name+contains&keywords[]=peter)          | Get the first 10 (default) ***experts*** where the ***name*** contains the word ***peter***     |
| [api/v1/advancedSearch/search.json?action=advSearch&type[]=institutions&filter[]=Name+contains&keywords[]=iode](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=institutions&filter[]=Name+contains&keywords[]=iode) | Get the first 10 (default) ***institutes*** where the ***name*** contains the word ***iode*** |

***type[]*** => defines what we are looking for, must be one of these : 

- experts
- institutes
- events

#### Examples

| Url                                                                                                                                                                                                                                                                  | Description                                                                                                              |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------|
| [/api/v1/advancedSearch/search.json?type[]=institutions&filter[]=Country+is&keywords[]=21&action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=institutions&filter[]=Country+is&keywords[]=21&action=advSearch)                        | Get the first 10 (default) ***institutes*** from ***Belgium*** (**country id** 21)                                     |
| [api/v1/advancedSearch/search.json?type[]=experts&filter[]=Institution+name+contains&keywords[]=vliz&action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Institution+name+contains&keywords[]=vliz&action=advSearch) | Get the first 10 (default) ***experts*** from institutes where the ***institute name*** contains the word ***vliz*** |
| [api/v1/advancedSearch/search.json?type[]=institutions&filter[]=Institution+name+contains&keywords[]=vliz&action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=institutions&filter[]=Name+contains&keywords[]=vliz&action=advSearch)   | Get the first 10 (default) ***institutes*** where the ***name*** contains the word ***vliz***                          |

***toggle[]*** => conditions for each type and filter, default is **OR**

#### Examples

| Url                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Description                                                                                                                                                  |
|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [/api/v1/advancedSearch/search.json?<br />type[]=experts&<br />filter[]=First+name+contains&<br />keywords[]=peter&<br />toggle[]=OR&<br />type[]=experts&<br />filter[]=First+name+contains&<br />keywords[]=arno&<br />action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=First+name+contains&keywords[]=peter&toggle[]=OR&type[]=experts&filter[]=First+name+contains&keywords[]=arno&action=advSearch)           | Get the first (**page** default) 10 (**limit** default) experts <br />where the first name contains 'peter' <br />**OR** 'arno'                              |
| [/api/v1/advancedSearch/search.json?<br />type[]=experts&<br />filter[]=Last+name+contains&<br />keywords[]=sierssens&<br />toggle[]=AND&<br />type[]=experts&<br />filter[]=First+name+contains&<br />keywords[]=peter&<br />action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Last+name+contains&keywords[]=sierssens&toggle[]=AND&type[]=experts&filter[]=First+name+contains&keywords[]=peter&action=advSearch) | Get the first (**page** default) 10 (**limit** default) experts <br />where the last name contains 'sierssens' <br />**AND** the first name contains 'peter' |
| [/api/v1/advancedSearch/search.json?<br />type[0]=experts&<br />filter[0]=Country+is&keywords[0]=6&<br />type[1]=experts&<br />filter[1]=Country+is&keywords[1]=111&<br />toggle[1]=OR&<br />action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[0]=experts&filter[0]=Country+is&keywords[0]=6&type[1]=experts&filter[1]=Country+is&keywords[1]=111&toggle[1]=OR&action=advSearch)                                                       | Get the first (**page** default) 10 (**limit** default) experts <br />from 'Angola' <br />**OR** from 'Kenya'                                                |
| [/api/v1/advancedSearch/search.json?type[0]=institutions&<br />filter[0]=Country+is&<br />keywords[0]=6&<br />type[1]=institutions&<br />filter[1]=Country+is&<br />keywords[1]=111&<br />toggle[1]=OR&<br />action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[0]=institutions&filter[0]=Country+is&keywords[0]=6&type[1]=institutions&filter[1]=Country+is&keywords[1]=111&toggle[1]=OR&action=advSearch)                             | Get the first (**page** default) 10 (**limit** default) institutes <br />located in 'Angola' <br />**OR** 'Kenya'                                          |
| [/api/v1/advancedSearch/search.json?type[0]=events&<br />filter[0]=Country+is&<br />keywords[0]=6&<br />type[1]=events&<br />filter[1]=Country+is&<br />keywords[1]=111&<br />toggle[1]=OR&<br />action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[0]=events&filter[0]=Country+is&keywords[0]=6&type[1]=events&filter[1]=Country+is&keywords[1]=111&toggle[1]=OR&action=advSearch)                                                     | Get the first (**page** default) 10 (**limit** default) events <br />organized in 'Angola' <br />**OR** 'Kenya'                                              |

***limit*** => result limit, default is **10**

#### Examples

| Url                                                                                                                                                                                                                                                     | Description                                                         |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| [/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch)                     | Get the first 10 (default) experts from Belgium (**country id** 21) |
| [/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch&limit=200](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch&limit=200) | Get the first 200 experts from Belgium (**country id** 21)          |

***page*** => pagination page number , default is **1** (first page)

#### Examples

| Url                                                                                                                                                                                                                                                                 | Description                                           |
|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| [/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch&limit=20&page=2](https://oceanexpert.org/api/v1/advancedSearch/search.json?type[]=experts&filter[]=Country+is&keywords[]=21&action=advSearch&limit=20&page=2) | Get experts 21 -> 40 from Belgium (**country id** 21) |

***filter[]*** => filter related to search types. Following filters can be applied for the different types.

| Expert                       | Institutes               | Events           |
|------------------------------|--------------------------|------------------|
| First name contains          | Worklocation contains | Title contains   |
| Last name contains           | Country is               | eType is         |
| Worklocation contains     | Sea regions of study is  | Summary contains |
|                              | Type is                  | Keywords contain |
| Phone/Fax contains           | Activities contains      | Address contains |
| Email contains               | Tel/Fax contains         | Country is       |
| Website URL contains         | Website URL contains     | Date between     |
| Country is                   | EDMO Code is             | Updated          |
| Sea regions of study is      | Updated                  | Created          |
| Member of group or sub-group | Created                  |                  |
| Job type is                  |                          |                  |
| Job title contains           |                          |                  |
| Department contains          |                          |                  |
| Institute name contains      |                          |                  |
| Subject Area is              |                          |                  |
| Activities include           |                          |                  |
| Working languages includes   |                          |                  |
| Degree contains              |                          |                  |
| Is retired                   |                          |                  |
| Is deceased                  |                          |                  |
| Is quality checked           |                          |                  |
| Quality last checked         |                          |                  |
| Updated                      |                          |                  |
| Created                      |                          |                  | 

#### Examples

| Url                                                                                                                                                                                                                                                                                                                                                                                                                    | Description                                                                                                                                                                                                                         |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [api/v1/advancedSearch/search.json?action=advSearch&type[]=experts&filter[]=Institution+name+contains&keywords[]=vliz](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=experts&filter[]=Institution+name+contains&keywords[]=vliz)                                                                                                                                                   | Get the first 10 (default) ***experts*** from institutes <br />where the ***institute name*** <br />contains the word ***vliz***                                                                                                |
| [api/v1/advancedSearch/search.json?action=advSearch&type[]=institutions&filter[]=Name+contains&keywords[]=vliz](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=institutions&filter[]=Name+contains&keywords[]=vliz)                                                                                                                                                                 | Get the first 10 (default) ***institutes*** <br />where the ***name*** <br />contains the word ***vliz***                                                                                                                         |
| [api/v1/advancedSearch/search.json?action=advSearch&type[]=events&filter[]=Title+contains&keywords[]=vliz](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[]=events&filter[]=Title+contains&keywords[]=vliz)                                                                                                                                                                           | Get the first 10 (default) ***events*** <br />where the ***title*** <br />contains the word ***vliz***                                                                                                                              |
| [api/v1/advancedSearch/search.json?action=advSearch&type[0]=events&filter[0]=Title+contains&keywords[0]=vliz&type[1]=events&filter[1]=Date+between&startDate[1]=22-09-2016](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[0]=events&filter[0]=Title+contains&keywords[0]=vliz&type[]=events&filter[1]=Date+between&startDate[1]=22-09-2016)                                          | Get the first 10 (default) ***events*** <br />where the ***title*** <br />contains the word ***vliz*** <br />and with a ***start date*** after ***22-09-2016*** (or ***2016-09-22***)                                               |
| [api/v1/advancedSearch/search.json?action=advSearch&type[0]=events&filter[0]=Title+contains&keywords[0]=vliz&type[1]=events&filter[1]=Date+between&startDate[1]=22-09-2016&endDate=31-12-2020](https://oceanexpert.org/api/v1/advancedSearch/search.json?action=advSearch&type[0]=events&filter[0]=Title+contains&keywords[0]=vliz&type[1]=events&filter[]=Date+between&startDate[1]=22-09-2016&endDate[1]=31-12-2020) | Get the first 10 (default) ***events*** <br />where the ***title*** <br />contains the word ***vliz*** <br />and with a ***start date*** after ***22-09-2016*** (or ***2016-09-22***) <br />and an end date before ***31-12-2020*** |

[back to top](#top)

# <a name="experts">Experts</a>

## Expert Details

API to get the details of expert

| Url                            | Description        | Parameters       | Examples                                                                                             |
|--------------------------------|--------------------|------------------|------------------------------------------------------------------------------------------------------|
| /api/v1/expert/{idExpert}.json | List Group members | limit<br/>offset | [https://oceanexpert.org/api/v1/expert/27036.json](https://oceanexpert.org/api/v1/expert/27036.json) |

[back to top](#top)

# <a name="institutes">Institutes</a>

## All Institutes

Get all the institutes known in OceanExpert as a JSON array.


| Url                  | Description                          | Parameters | Examples                                                                                   |
|----------------------|--------------------------------------|------------|--------------------------------------------------------------------------------------------|
| /api/v1/institutes | Get all institutes with their info |            | [https://oceanexpert.org/api/v1/institutes](https://oceanexpert.org/api/v1/institutes) |


## Institute Details

Get institute details and associated members.

| Url                                      | Description           | Parameters                           | Examples                                                                                                     |
|------------------------------------------|-----------------------|--------------------------------------|--------------------------------------------------------------------------------------------------------------|
| /api/v1/institute/{idInstitute}.json | Give institute info | limit (members)<br/>offset (members) | [https://oceanexpert.org/api/v1/institute/6860.json](https://oceanexpert.org/api/v1/institute/6860.json) |

[back to top](#top)

# <a name="regions">Regions</a>

## All Regions

Get all the regions known in OceanExpert as a JSON array.


| Url             | Description     | Parameters | Examples                                                                         |
|-----------------|-----------------|------------|----------------------------------------------------------------------------------|
| /api/v1/regions | Get all regions |            | [https://oceanexpert.org/api/v1/regions](https://oceanexpert.org/api/v1/regions) |


## Region Details

Region details and associated countries.

| Url                       | Description      | Parameters | Examples                                                                           |
|---------------------------|------------------|------------|------------------------------------------------------------------------------------|
| /api/v1/region/{idRegion} | Give region info | -          | [https://oceanexpert.org/api/v1/region/1](https://oceanexpert.org/api/v1/region/1) |

[back to top](#top)

# <a name="events">Events</a>

## Calendar Events:
This API displays all the events for the group. (for e.g. IOC is having group id 31) 

- If a start- and enddate are given, only events between those date will be give.
- If a only a year is given, events will be given between 1 jan and 31 dec of that year.
- If no start- and enddate or year are given, only events for the next 3 months are give.

| Url                                    | Description                                                         | Parameters     | Examples                                                                                                                                                                           |
|----------------------------------------|---------------------------------------------------------------------|----------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| api/v1/getEventCalendar/{idGroup}.json | List all the events for group 31 between 01/03/20218 and 30/06/2018 | start<br/> end | [https://oceanexpert.org/api/v1/getEventCalendar/31.json?start=2018-03-01&end=2018-06-30](https://oceanexpert.org/api/v1/getEventCalendar/31.json?start=2018-03-01&end=2018-06-30) |
| api/v1/getEventCalendar/{idGroup}.json | List all the events for group 31 between 01/01/20218 and 31/12/2018 | year           | [https://oceanexpert.org/api/v1/getEventCalendar/31.json?year=2018](https://oceanexpert.org/api/v1/getEventCalendar/31.json?year=2018)                                             |
| api/v1/getEventCalendar/{idGroup}.json | List all the events for group 31 between today and three months     |                | [https://oceanexpert.org/api/v1/getEventCalendar/31.json](https://oceanexpert.org/api/v1/getEventCalendar/31.json)                                                                 |

## Upcoming Events:
This Api list the upcoming event for the group.

| Url                                                   | Description                                                                 | Parameters          | Examples                                                                                                                             |
|-------------------------------------------------------|-----------------------------------------------------------------------------|---------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| api/v1/getUpcomingEvents/{idGroup}.json               | List the 5 next upcoming event in the Website Group with id {idGroup}       | limit defaults to 5 | [https://oceanexpert.org/api/v1/getUpcomingEvents/31.json](https://oceanexpert.org/api/v1/getUpcomingEvents/31.json)                 |
| api/v1/getUpcomingEvents/{idGroup}.json?limit={limit} | List the {limit} next upcoming event in the Website Group with id {idGroup} | limit               | [https://oceanexpert.org/api/v1/getUpcomingEvents/31.json?limit=8](https://oceanexpert.org/api/v1/getUpcomingEvents/31.json?limit=8) |

## Event Record:
API to get the event data
	
| Url                                          | Description         | Parameters | Examples                                                                                                                         |
|----------------------------------------------|---------------------|------------|----------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/event/viewEventRecord/{idEvent}.json | List event overview | -          | [https://oceanexpert.org/api/v1/event/viewEventRecord/1879.json](https://oceanexpert.org/api/v1/event/viewEventRecord/1879.json) |

## Event Agenda:
API to list Event Agenda items

| Url                                          | Description             | Parameters | Examples                                                                                                                         |
|----------------------------------------------|-------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/event/viewEventAgenda/{idEvent}.json | List event Agenda items | -          | [https://oceanexpert.org/api/v1/event/viewEventAgenda/1879.json](https://oceanexpert.org/api/v1/event/viewEventAgenda/1879.json) |

## Event Documents
API to list all the event documents including agenda documents

| Url                                        | Description          | Parameters | Examples                                                                                                                     |
|--------------------------------------------|----------------------|------------|------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/event/viewEventDocs/{idEvent}.json | List event Documents | -          | [https://oceanexpert.org/api/v1/event/viewEventDocs/1879.json](https://oceanexpert.org/api/v1/event/viewEventDocs/1879.json) |

## Event Participants
API to list all the participants in the event

| Url                                                | Description             | Parameters | Examples                                                                                                                                     |
|----------------------------------------------------|-------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/event/viewEventParticipants/{idEvent}.json | List event participants | -          | [https://oceanexpert.org/api/v1/event/viewEventParticipants/1879.json](https://oceanexpert.org/api/v1/event/viewEventParticipants/1879.json) |

## <a name="updateEventParticipants">Update the list of Event Participants</a> (POST method only)
API call to update the list of participants in an event in OceanExpert. 
Each participant will be marked as confirmed.

Mind that each training event that has been created using the API will contain the roles 'learner' and 'instructor',
for all other events you will have to check, in OceanExpert, the list of existing roles for that event.

| Url                                            | Description        | Parameters     | Examples                                                                                                                                 |
|------------------------------------------------|--------------------|----------------|------------------------------------------------------------------------------------------------------------------------------------------|
| api/v1/event/updateEventParticipants/{idEvent} |update the list of participants | see list below | [https://oceanexpert.org/api/v1/event/updateEventParticipants/45444](https://oceanexpert.org/api/v1/event/updateEventParticipants/45444) |

### Header
The header of the call must contain the **Authorization** header that has a value **Bearer XYZ**,
where XYZ is the content of the token that can be obtained via the LOGIN API (see bottom of doc).

### Mandatory parameters

The url must contain a valid {idEvent}, pointing to a real event in OceanExpert. 
If not, the call will give back an error telling why it's not ok.

The parameters are send as a JSON array in the body of the POST. 
Each line of the array contains the OceanExpert id, and the role of that expert in this event, to be added to the participants list. 

e.g.
```
{
    "35711":"learner",
    "35713":"instructor",
    "35712":"test"
}
```


### Return
In case of succes the call will return a JSON containing

- the status ( == 0 in case of success)
- the old list of participants
- the new list of participants

e.g. 
```
{
    "status": 0,
    "oldEventParticipants": {
        "35711": "",
        "35712": "test",
        "44287": ""
    },
    "newEventParticipants": {
        "35711": "learner",
        "35712": "",
        "35713": "instructor"
    }
}
```
In case there is a problem, the call will return a JSON containing

- error code (helps us to find the problem and to debug if needed)
- error message

e.g.
```
{
    "status": 2,
    "error": "please provide the id of a real, existing event, '3732df' is not valid (not numeric but a string)"
} 
```
```
{
    "status": 2,
    "error": "please provide the id of a real, existing event, '0' is not valid "
} 
```
```
{
    "status": 6,
    "error": "cannot find an event with idEvent '4444444'"
} 
```

[back to top](#top)

## <a name="createEvent">Create a new Event</a> (POST method only)
API call to create a new event in OceanExpert. 

| Url                | Description        | Parameters     | Examples                                                                                 |
|--------------------|--------------------|----------------|------------------------------------------------------------------------------------------|
| api/v1/createEvent | Create a new event | see list below | [https://oceanexpert.org/api/v1/createEvent](https://oceanexpert.org/api/v1/createEvent) |

### Header
The header of the call must contain the **Authorization** header that has a value **Bearer XYZ**, 
where XYZ is the content of the token that can be obtained via the LOGIN API (see bottom of doc).

### Mandatory parameters

The parameters are send as a JSON array in the body of the POST.

- idContact : int, valid OE id of the person to contact to obtain more info about this event
- eventType : int, type of the event (int 1-7)
  - 1: Meeting
  - 2: Conference
  - 3: Workshop
  - 4: Training Course
  - 5: Visit
  - 6: Internship
  - 7: Other
- eventTitle : text, title of the event
- startDate : date, valid start date (in the future) of the event in the format YYYY-MM-DD
- startDate : date, valid  end date (in the future and after startDate) of the event in the format YYYY-MM-DD

### Other parameters

- shortTitle : text, defaults to '', a shorter version of the title for this event
- summary : text, defaults to '', summary of the content, can contain valid HTML
- eventAddress : text, defaults to '', street address of where the event is taking place
- eventCity : text, defaults to '', city of where the event is taking place
- eventState : text, defaults to '', state of where the event is taking place 
- eventPostCode : text, defaults to '', postcode/ZIP of where the event is taking place
- country : int, id of the country where the event is taking place
- institute : int, defaults to '', id of the institute that organizes this event
- instituteAddress : text, defaults to '', address of the institute organizing this event
- eventNotes : text, defaults to '', some extra notes
- eventWebsite : text, defaults to '', url of the event website
- eventKeywords : text, defaults to '', list of keywords, no special separator
- open : int, defaults to 0, how can people register for this event?
      - 0 = not defined
      - 1 = open attendance 
      - 2 = attendance by invitation
      - 3 = attendance by application
- calenderGroups : array, defaults to '', array of group ids to which this event should be added, will result in the event being shown on the calendars of these groups
- label and labelGroup : array, defaults to '', label and for what group this label is  valid, labels can be
    - 1 = official meeting
    - 2 = training course
    - 3 = expert assistance

### Return
In case of succes the call will return a JSON containing

- the status ( == 0 in case of success)
- error message (if any)
- the id of the newly created event

e.g.
```
{
    "status": 0,
    "error": "status 0 means no errors",
    "eventId": 3436
}
```

[back to top](#top)

# <a name="documents">Documents</a>

## Document details by ID
API to get document details by ID

| Url                                                   | Description           | Examples                                                                                                                                       |
|-------------------------------------------------------|-----------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/document/viewDocumentRecord/{idDocument}.json | List document details | [https://oceanexpert.org/api/v1/document/viewDocumentRecord/19058.json](https://oceanexpert.org/api/v1/document/viewDocumentRecord/19058.json) |

## Document download links
API to get document download links

| Url                                                  | Description                  | Examples                                                                                                                                     |
|------------------------------------------------------|------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/document/viewDocFilesPopup/{idDocument}.json | List document download files | [https://oceanexpert.org/api/v1/document/viewDocFilesPopup/19058.json](https://oceanexpert.org/api/v1/document/viewDocFilesPopup/19058.json) |

## View all document lists
API to get all document list in group

| Url                                      | Description                         | Examples                                                                                                             |
|------------------------------------------|-------------------------------------|----------------------------------------------------------------------------------------------------------------------|
| /api/v1/document/doclists/{idGroup}.json | View all document lists for a group | [https://oceanexpert.org/api/v1/document/doclists/31.json](https://oceanexpert.org/api/v1/document/doclists/31.json) |

## View document list details
API to get document list details

| Url                                                 | Description                      | Examples                                                                                                                               |
|-----------------------------------------------------|----------------------------------|----------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/document/viewDoclistRecord/{idDoclist}.json | View all the documents in a list | [https://oceanexpert.org/api/v1/document/viewDoclistRecord/90.json](https://oceanexpert.org/api/v1/document/viewDoclistRecord/90.json) |

[back to top](#top)

# <a name="groups">Groups</a>

## Groups tree
API to list the groups in tree view

| Url                              | Description                         | Parameters | Examples                                                                                             |
|----------------------------------|-------------------------------------|------------|------------------------------------------------------------------------------------------------------|
| /api/v1/grouptree/{idGroup}.json | List groups tree for a parent group | -          | [https://oceanexpert.org/api/v1/grouptree/31.json](https://oceanexpert.org/api/v1/grouptree/31.json) |

## Group members

API to list the groups members.

- ***limit*** (int) : the maximum number of results you want to get, default: 10
- ***offset*** (int) : where to start, default : 0 (start with the first result)
- ***subgroups*** (boolean): do we want to get all the subgroups as well, default : 1 (true)

| Url                          | Description             | Parameters                     | Examples                                                                                     |
|------------------------------|-------------------------|--------------------------------|----------------------------------------------------------------------------------------------|
| /api/v1/group/{idGroup}.json | List members of a group | limit<br/>offset<br/>subgroups | [https://oceanexpert.org/api/v1/group/31.json](https://oceanexpert.org/api/v1/group/31.json) |
| /api/v1/group/{idGroup}      | List members of a group | limit<br/>offset<br/>subgroups | [https://oceanexpert.org/api/v1/group/31](https://oceanexpert.org/api/v1/group/31)           |

### examples

- get all the members of the OBIS group and all the members from the subgroups as well
```
https://www.oceanexpert.org/api/v1/group/386?limit=1000
```
- get the first 10 members of the OBIS group and all the members from the subgroups as well
```
https://www.oceanexpert.org/api/v1/group/386?limit=10
```
- get members 10 to 20 of the OBIS group and all the members from the subgroups as well
```
https://www.oceanexpert.org/api/v1/group/386?limit=10&offset=10
```
- get the members of the OBIS group only and ***NOT*** the members from the subgroups
```
https://www.oceanexpert.org/api/v1/group/386?subgroups=0
```

[back to top](#top)

# <a name="reports">Reports</a>

## Country List

API to get all the countries

| Url                              | Description        | Parameters | Examples                                                                                                           |
|----------------------------------|--------------------|------------|--------------------------------------------------------------------------------------------------------------------|
| /api/v1/getCountryList/list.json | List all countries | -          | [https://oceanexpert.org/api/v1/getCountryList/list.json](https://oceanexpert.org/api/v1/getCountryList/list.json) |

API to list all the country participation reports

## Reports
### Country Reports
possible extra parameters:
- report type
    - Subsidiary body membership (type = 1)  
    - Official meeting participants (type = 2)  
    - Training course participants (type = 3)  
    - Grants (type = 4)  
    - Expert assistance (type = 5)  
    - Assistance provided (type = 6)  
    - Assistance received (type = 7)
- country : OE country id or **all**
- year 


| Url                                                | Description                        | Parameters                      | Examples                                                                                                                                                                  |
|----------------------------------------------------|------------------------------------|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/countryReports/{idGroup}?reportType={type} | Subsidiary body membership reports | reportType<br/>year<br/>country | [https://oceanexpert.org/api/v1/countryReports/31?reportType=1&country=21&year=2017 ](https://oceanexpert.org/api/v1/countryReports/31?reportType=1&country=21&year=2017) |
| idem                                               | Training course participants       | reportType<br/>year<br/>country | [https://oceanexpert.org/api/v1/countryReports/31?reportType=3&country=21&year=2022 ](https://oceanexpert.org/api/v1/countryReports/31?reportType=3&country=21&year=2022) |

### Event Participants
possible extra parameters:
- year : can be a 4 digit year or **all**
- eventType : int, type of the event (int 1-7)
    - 1: Meeting
    - 2: Conference
    - 3: Workshop
    - 4: Training Course
    - 5: Visit
    - 6: Internship
    - 7: Other

| Url                                                    | Description                  | Parameters                                                                                        | Examples                                                                                                                                                             |
|--------------------------------------------------------|------------------------------|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| /api/v1/eventParticipants/{idGroup}?year={year         | all}&eventType={eventTypeId} | Make a json response with members of the given group and the events they joined in the given year | [http://oceanexpert.org/api/v1/eventParticipants/269?year=all&eventType=2](http://oceanexpert.org/api/v1/eventParticipants/269?year=all&eventType=2)                 |
| /api/v1/reports/eventParticipants/{idGroup}?year={year | all}&eventType={eventTypeId} | Make a json response with members of the given group and the events they joined in the given year | [http://oceanexpert.org/api/v1/reports/eventParticipants/269?year=all&eventType=2](http://oceanexpert.org/api/v1/reports/eventParticipants/269?year=all&eventType=2) |

[back to top](#top)

# <a name="login">Login</a> (POST method only)
calling the API with correct username and password will return a JSON containing the token. This token can be used for other actions and does contain information about the user.

- idInd       OceanExpert id
- fname       first name
- sname       surname/last name
- gender      gender
- image       profile image, relatie to https://oceanexpert.org
- name        experts complete name (useless, is concat of fname and sname)
- email       experts email address
- jobtitle    job title
- idInst      OceanExpert institute id
- instName    OceanExpert institute name
- instNameEng OceanExpert institute English name
- insCountry  English name of the institute country
- insCountryCode ISO 3166-1 / alpha-2 country code of the institute country
- country     English name of the expert country
- countryCode ISO 3166-1 / alpha-2 country code of the expert country
- groups      list of groups where the expert belongs to
- oeRole      OceanExpert role

| Url              | Description | Parameters             | Examples                                                                           |
|------------------|-------------|------------------------|------------------------------------------------------------------------------------|
| /api/login_check | Login API   | username<br />password | [https://oceanexpert.org/api/login_check](https://oceanexpert.org/api/login_check) |

**Note** Login API requests MUST include a valid [User-Agent header](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent). Requests with no User-Agent header will be rejected and throw error as <code>406 Not Acceptable</code>.</span>~~
