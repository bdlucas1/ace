"use strict";

const holeZoom = 17
const courseZoom = 15
const selectCourseZoom = 11


////////////////////////////////////////////////////////////
//
// utility
//

function divlog(kind, text) {
}

function intercept(fun) {
    var oldFun = console[fun]
    console[fun] = (...args) => {
        oldFun(...args)
        //divLog(fun, args.join(" ")
        const consoleElt =  document.querySelector("#console")
        if (consoleElt) {
            const elt = document.createElement("div")
            elt.classList.add("console-" + fun)
            elt.innerText = args.join(" ")
            consoleElt.appendChild(elt)
            elt.scrollIntoView()
        } else {
            oldFun("no console element")
        }
    }
}

// intercept stuff to send it to our console element
for (const fun of ["log", "info", "warning", "error", "trace", "debug"])
    intercept(fun)
window.onerror = e => console.error(e)
window.onunhandledrejection = e => console.error(e.reason.stack)


const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

// return current pos
var lastLoc
async function getPos() {
    if (lastLoc) {
        // use last reported by watchPosition
        return lastLoc;
    } else {
        // otherwise ask
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy: true})
        })
        return pos
    }
}

// turf point from various other representations
function turf_point(ll) {
    if (ll.getLatLng) {
        const {lat, lng} = ll.getLatLng()
        return turf.point([lng, lat])
    } else if (Array.isArray(ll) && ll.length==2) {
        // TODO: this is dangerous as tuples are not always lat,lon
        const [lat, lon] = ll
        return turf.point([lon, lat])
    } else if (ll.coords) {
        const {latitude: lat, longitude: lon} = ll.coords
        return turf.point([lon, lat])
    } else {
        // TODO: hope for the best?
        return ll
    }
}

// TODO: use this everywhere
function turf_distance(a, b) {
    return turf.distance(turf_point(a), turf_point(b), {units: "meters"})
}

function defineIcon(width, height, url) {
    return L.Icon.extend({
        options: {
            iconSize: [width, height],
            iconAnchor: [width/2, height/2],
            iconUrl: url,
        }
    })
}

const CrosshairIcon = defineIcon(30, 30, "crosshair.png")

function svgIcon(innerSvg, className) {
    const icon = L.divIcon({
        html: `
          <svg class="${className}">
            ${innerSvg}
          </svg>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        //style: {overflow: visible},
        className: "svg-icon",
    })
    return icon
}


////////////////////////////////////////////////////////////
//
// set up our map using Leaflet
//

var theMap

function loadMap(elt, layerControl = true, locateControl = false) {

    // Thunderforest maps
    function thunderForest(type) {
        const key = "86d5ed83e1914677ba41e815a4126f2f"
        const url = `https://tile.thunderforest.com/landscape/{z}/{x}/{y}{r}.png?apikey=${key}`
        const attribution = `
            ©<a href='https://www.thunderforest.com' target='_blank'>Thunderforest</a> |
            ©<a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>
        `
        return L.tileLayer(url, {attribution})
    }

    // USGS top maps
    function USGS(type, maxZoom=16) {
        const url = `https://basemap.nationalmap.gov/arcgis/rest/services/${type}/MapServer/tile/{z}/{y}/{x}`
        const attrURL = "https://basemap.nationalmap.gov/arcgis/rest/services"
        const attribution = `<a href='${attrURL}' target='_blank'>USGS</a>`
        return L.tileLayer(url, {attribution, maxZoom})
    }

    function OSM() {
        const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        return L.tileLayer(url, {maxZoom: 20})
    }

    // seems to cache for 12h
    // 200k free per billing period month
    // I have billing information on file
    function mapBox(style) {
        const token =
              "pk.eyJ1IjoiYmRsdWNhczEiLCJhIjoiY2t5cW52dmI1MGx0ZjJ1cGV5NnM1eWw5NyJ9" +
              ".1ig0mdAnI6dBI5MtVf-JKA"
        const url = "https://api.mapbox.com/styles/v1/{style}/tiles/{z}/{x}/{y}{r}?access_token={token}"
        const attribution = `
            ©<a href='https://www.mapbox.com' target='_blank'>MapBox</a> |
            ©<a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>
        `
        return L.tileLayer(url, {attribution, style, token, maxZoom: 20})
    }

    // seems to cache for 4h
    // 100k free per month on free plan
    // no billing on file - hard limit
    // can limit by domain (?)
    function mapTiler() {
        const url = "https://api.maptiler.com/maps/satellite/{z}/{x}/{y}{r}.jpg?key=J95t1VSvDVTrfdsKsqyV"
        return L.tileLayer(url, {maxZoom: 20})
    }

    // seems to cache for 24h
    // no key, so no limit?
    function ESRI() {
        const url = "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        return L.tileLayer(url, {maxZoom: 20})
    }

    // these will be presented in the layer switch control
    const baseMaps = [
        OSM(),
        mapBox("mapbox/satellite-streets-v12"),

        /*
        ESRI(),
        mapTiler(),
        */

        /*
        "Thunderforest landscape": thunderForest("landscape"),
        "MapBox outdoors": mapBox("mapbox/outdoors-v12"),
        "MapBox custom": mapBox("bdlucas1/ckyqokvgx03so14kg7zgkvfsd"),
        "USGS topo": USGS("USGSTopo"),
        "USGS imagery": USGS("USGSImageryOnly"),
        "USGS imagery topo": USGS("USGSImageryTopo"),
        */
    ]

    // create the map
    theMap = L.map(elt, {
        rotate: true,
        zoomSnap: 0.2,
        zoomControl: false,
        rotateControl: false,
    }).setZoom(selectCourseZoom)

    // our own layer switcher
    var currentLayerNumber = 0
    theMap.addLayer(baseMaps[currentLayerNumber])
    document.querySelector("#layer").addEventListener("click", () => {
        theMap.removeLayer(baseMaps[currentLayerNumber])
        currentLayerNumber = (currentLayerNumber + 1) % baseMaps.length
        print("switching to layer", currentLayerNumber)
        theMap.addLayer(baseMaps[currentLayerNumber])
    })
}


//
//
// settings menu
//

async function manageSettings() {

    // set up settings menu
    const settingsElt = document.querySelector("#settings")
    function addSetting(text, action) {
        const itemElt = document.createElement("div")
        itemElt.innerText = text
        itemElt.classList.add("settings-button")
        settingsElt.insertBefore(itemElt, document.querySelector("#console"))
        itemElt.addEventListener("click", action)
    }

    // clear course data button
    addSetting("Clear course data", () => {
        print("clearing local storage")
        localStorage.clear()
        toggleSettings()
    })

    // manage settings menu display
    var showing = false
    settingsElt.style.visibility = "hidden"
    const toggleSettings = () => {
        showing = !showing
        settingsElt.style.visibility = showing? "visible" : "hidden";
    }

    // set up show-settings button
    const settingsButton = document.querySelector("#show-settings")
    settingsButton.addEventListener("click", toggleSettings)
}


////////////////////////////////////////////////////////////
//
// scorecard, selected hole
//

var selectedHole
var selectedHoleLayer
var holeFeatures

async function selectHole(holeNumber) {

    print("selectHole", holeNumber)

    // deselect currently selected hole
    if (selectedHole) {
        document.querySelector(`#hole-number-${selectedHole}`).classList.remove("selected")
        document.querySelector(`#hole-score-${selectedHole}`).classList.remove("selected")
    }

    // style selected hole on scorecard
    selectedHole = holeNumber
    document.querySelector(`#hole-number-${selectedHole}`).classList.add("selected")
    document.querySelector(`#hole-score-${selectedHole}`).classList.add("selected")

    // do we have hole info to show?
    if (!holeFeatures[holeNumber]) {
        print("no features")
        return
    }

    // compute and set bearing from start to end of hole
    const feature = holeFeatures[holeNumber][0]
    const coordinates = feature.geometry.coordinates
    const bearing = turf.bearing(coordinates[0], coordinates[coordinates.length - 1])
    await theMap.setBearing(-bearing)
    
    // select and show hole features
    if (selectedHoleLayer)
        theMap.removeLayer(selectedHoleLayer)
    selectedHoleLayer = L.geoJSON(holeFeatures[holeNumber], {
        style: feature => {return {className: `golf-${feature.properties.golf}`}}
    }).addTo(theMap);

    // center hole on map
    const center = turf.center({type: "FeatureCollection", features: holeFeatures[holeNumber]})
    const [lon, lat] = center.geometry.coordinates
    theMap.setView([lat, lon], holeZoom)
    resetPath()

}

function manageScorecard() {

    // two tables, front and back nine
    var holeNumber = 1
    document.querySelectorAll(".scorecard").forEach(table => {

        for (var i = 0; i < 9; i++, holeNumber++) {

            // hole number cell
            var td = document.createElement("td")
            td.innerText = holeNumber
            td.id = `hole-number-${holeNumber}`
            td.addEventListener("click", function() {selectHole(Number(this.innerText))})
            table.querySelector(".hole-number").appendChild(td)

            // score cell
            td = document.createElement("td")
            td.id = `hole-score-${holeNumber}`
            td.holeNumber = holeNumber
            td.addEventListener("click", function() {selectHole(Number(this.holeNumber))})
            table.querySelector(".hole-score").appendChild(td)
        }
    })

    // add or subtract one from score
    function updateScore(holeNumber, update) {

        // update hole score
        const td = document.querySelector(`#hole-score-${holeNumber}`)        
        const newScore = Number(td.innerText) + update
        td.innerText = newScore > 0? String(newScore) : " "

        // this assumes the "hole" feature is the first in the array of features for each hole
        const par = holeNumber => holeFeatures[holeNumber][0].properties.par

        // update totals
        function computeScore(start) {
            for (var holeNumber = start, total = 0, toPar = 0, i = 0; i < 9; i++, holeNumber++) {
                const score = Number(document.querySelector(`#hole-score-${holeNumber}`).innerText)
                total += score
                if (score > 0)
                    toPar += score - par(holeNumber)
            }
            return [total, toPar]
        }                
        const [outTotal, outToPar] = computeScore(1)
        const [inTotal, inToPar] = computeScore(10)

        const total = outTotal + inTotal
        const fmtToPar = toPar => toPar == 0? "E": toPar > 0? "+" + toPar : toPar
        const toPar = inToPar + outToPar

        document.querySelector("#out-score").innerText = outTotal > 0? outTotal : ""
        document.querySelector("#in-score").innerText = inTotal > 0? inTotal : ""
        document.querySelector("#total-score").innerText = inTotal>0 && outTotal>0? total : ""

        document.querySelector("#out-to-par").innerText = outTotal>0? fmtToPar(outToPar) : ""
        document.querySelector("#in-to-par").innerText = inTotal>0? fmtToPar(inToPar) : ""
        document.querySelector("#total-to-par").innerText = outTotal>0 && inTotal>0? fmtToPar(toPar) : ""
    }

    // set up button click handlers
    document.querySelector("#plus").addEventListener("click", () => updateScore(selectedHole, +1))
    document.querySelector("#minus").addEventListener("click", () => updateScore(selectedHole, -1))
}



////////////////////////////////////////////////////////////
//
// path and location
//

var locationMarker = undefined
var accuracyMarker = undefined
var pathMarkers = []
var pathLine

// draw a line connecting markers and update distance info
// only use the location marker if it's visible in the current viewport
function updateLine() {

    // update the polyline
    const useMarkers = pathMarkers.filter(m => m!=locationMarker || theMap.getBounds().contains(m.getLatLng()))
    const lls = useMarkers.map(m => m.getLatLng())
    pathLine.setLatLngs(lls)
    
    // update the distance info
    for (const m of pathMarkers)
        m.unbindTooltip()
    for (var i = 1; i < useMarkers.length; i++) {
        const distance = turf.distance(turf_point(useMarkers[i-1]), turf_point(useMarkers[i]), {units: "yards"})
        const tip = Math.round(distance) + " yd"
        useMarkers[i].bindTooltip(tip, {
            permanent: true,
            direction: "right",
            offset: L.point([20, 0]),
            className: "distance-info"
        })
    }
}

function resetPath() {
    for (const marker of pathMarkers)
        if (marker != locationMarker)
            marker.remove()
    pathMarkers = locationMarker? [locationMarker] : []
    updateLine()
}

// move the locationMarker, optionally centering it
function moveLocationMarker(loc, center) {
    const latlon = [loc.coords.latitude, loc.coords.longitude]
    print("moving location marker to", latlon, "centering", center, "accuracy", loc.coords.accuracy, "m")
    locationMarker.setLatLng(latlon)
    accuracyMarker.setLatLng(latlon)
    accuracyMarker.setRadius(loc.coords.accuracy)
    if (center)
        theMap.setView(latlon)
    lastLoc = loc
    updateLine()
}

// center the current location in the map and reset markers
async function goToCurrentLocation() {
    
    // center on current position
    const loc = await getPos()
    moveLocationMarker(loc, true)
    
    // remove other markers
    resetPath()
}

async function manageLocation() {
    
    // set up location and accuracy marker, and polyline
    locationMarker = L.marker([0,0], {icon: new CrosshairIcon()}).addTo(theMap)
    accuracyMarker = L.circleMarker([0,0], {
        radius: 100,
        color: "blue", opacity: 0.3,
        fillColor: "blue", fillOpacity: 0.1,
    }).addTo(theMap)
    pathLine = L.polyline([], {className: "path-line"}).addTo(theMap)
    
    // watch for position changes, and update locationMarker accordingly
    // this does not center the locationMarker
    // if lastLoc is already set then it will be a test position so we don't
    // watch actual position
    if (!lastLoc) {
        navigator.geolocation.watchPosition(
            (loc) => moveLocationMarker(loc, false),
            print,
            {enableHighAccuracy: true}
        )
    }

    // locate button moves map to current location
    const locateButton = document.querySelector("#locate")
    locateButton.innerHTML = "<img src='crosshair.png'></img>"
    locateButton.addEventListener("click", goToCurrentLocation)

    // clicking on map adds a marker
    const markerIcon = svgIcon("<circle>", "path-marker")
    theMap.on("click", function(e) {

        print("click map")

        // create marker
        const marker = L.marker(e.latlng, {
            icon: markerIcon,
            draggable: true,
            autoPan: false,
            autoPanOnFocus: false, // https://github.com/Raruto/leaflet-rotate/issues/28
        }).addTo(theMap)
        pathMarkers.push(marker)

        // redraw line and update distance info to include new marker
        updateLine()

        // clicking marker removes it
        marker.on("click", () => {
            print("click marker")
            marker.remove()
            pathMarkers = pathMarkers.filter(m => m !== marker)
            updateLine()
        })

        // dragging marker updates line
        marker.on("drag", (e) => {
            print("drag")
            updateLine()
        })
    })

    // initial location
    await goToCurrentLocation()

}


////////////////////////////////////////////////////////////
//
// courses
//

// for selecting courses
var courseMarkers

// do an Overpass query against OSM data
async function query(q) {

    const full_q = `
        [out:json][timeout:25];
           ${q}
        out body;
        >;
        out skel qt;
    `
    const api = "https://overpass-api.de/api/interpreter"
    const response = await fetch(api, {method: "POST", body: full_q,})
    try {
        const response_json = await response.json()
        const geojson = osmtogeojson(response_json)
        return geojson
    } catch(e) {
        print(response.text())
    }
}

// TODO: mechanism to clear cache. for now: at console, localStorage.clear()
async function query_course_features(latlon, distance=5000) {

    const [lat, lon] = latlon

    const features_query = `
        (
           way[golf="hole"](around:${distance},${lat},${lon});
           way[golf="tee"](around:${distance},${lat},${lon});
           way[golf="fairway"](around:${distance},${lat},${lon});
           way[golf="bunker"](around:${distance},${lat},${lon});
           way[golf="green"](around:${distance},${lat},${lon});
        );
    `
    const features = await query(features_query)
    return features;
}

// TODO: need better strategy: cover visible map area with 0.1 deg tiles
// instead of having a large
async function query_courses(south, west, north, east) {
    const q = `way[leisure=golf_course](${south},${west},${north},${east});`
    const courses = await query(q)
    const result = {}
    for (const course of courses.features) {
        const center = turf.centroid(course)
        const [lon, lat] = center.geometry.coordinates
        result[course.properties.name] = [lat, lon]
    }
    return result
}

async function cache_json(key, fun) {
    var value = localStorage.getItem(key)
    if (value) {
        print("using cached data for", key)
        return JSON.parse(value);
    } else {
        print("querying Overpass for", key)
        value = await fun()
        localStorage.setItem(key, JSON.stringify(value));
        return value
    }
}

// TODO: clear course markers?
async function loadCourse(name, latlon) {

    // get course data
    const course = await cache_json(name, () => query_course_features(latlon))

    // group features by nearest hole into holeFeatures array
    // holeFeatures is indexed by hole number,
    // and each element is an array of features associated with that hole
    // first element of each array is the hole feature (line representing hole) itself
    //
    // TODO: this doesn't really work quite right
    // BUG? see e.g. James Baird State Park - 16 fairway is assigned to hole 1

    // first get the hole feature (line representing hole)
    holeFeatures = []
    for (const feature of course.features) {
        if (feature.properties.golf == "hole") {
            // other code depends on the "hole" feature being first in the features array
            const holeNumber = feature.properties.ref
            holeFeatures[holeNumber] = [feature]
        }
    }

    // then for each non-hole feature associate it with the closest hole
    for (const feature of course.features) {
        if (feature.properties.golf != "hole") {
            const centroid = turf.centroid(feature)
            var minDistance = Infinity
            var minHoleNumber
            for (const holeNumber in holeFeatures) {
                const holeFeature = holeFeatures[holeNumber][0]
                const distance = turf.pointToLineDistance(centroid, holeFeature)
                if (distance < minDistance) {
                    minDistance = distance
                    minHoleNumber = holeNumber
                }
            }
            holeFeatures[minHoleNumber].push(feature) 
        }
    }

    // show the course
    print("setview", latlon)
    theMap.setView(latlon, courseZoom)

}

function manageCourses()  {

    // put up markers to select courses centered around current location
    async function selectCourse() {

        // clean slate
        if (courseMarkers)
            courseMarkers.remove()
        courseMarkers = L.layerGroup().addTo(theMap)
        resetPath()
        theMap.setBearing(0)

        // snap to tile boundaries
        const tile_size = 0.25 // needs to be power of 2
        const dn = x => Math.floor(x/tile_size)*tile_size
        const up = x => Math.floor((x+tile_size)/tile_size)*tile_size

        // compute bounding box snapped to tiles of size tile_size deg
        const bounds = theMap.getBounds()
        const south = dn(bounds.getSouth())
        const west = dn(bounds.getWest())
        const north = up(bounds.getNorth())
        const east = up(bounds.getEast())

        // iterate over tiles adding markers
        const pos = await getPos()
        for (var s = south; s < north; s += tile_size) {
            for (var w = west; w < east; w += tile_size) {
                const n = s + tile_size
                const e = w + tile_size
                const key = s + "," + w + "," + n + "," + e
                const courses = await cache_json(key, () => query_courses(s, w, n, e))
                for (const [course_name, latlon] of Object.entries(courses)) {
                    // if we're near course abort and just load that course
                    // TODO: tune this distance?
                    if (turf_distance(pos, latlon) < 1000) {
                        loadCourse(course_name, latlon)
                        return // TODO: break?
                    }
                    const marker = L.marker(latlon).addTo(theMap).on("click", () => {
                        courseMarkers.remove()
                        loadCourse(course_name, latlon)
                    }).addTo(courseMarkers)
                }
            }
        }

        /*
        // not available any more
        // lock screen orientation
        screen.orientation.lock('portrait')
            .then(() => print('orientation locked '))
            .catch(err => print('failed to lock orientation:', err))
        */
    }

    const selectCourseButton = document.querySelector("#select-course")
    selectCourseButton.innerHTML = "<img src='golfer.png'></img>"
    selectCourseButton.addEventListener("click", selectCourse)

    // this is our initial action
    selectCourse()
}


////////////////////////////////////////////////////////////
//
// entry point
//

async function show() {

    // TODO: move score-row to manageScorecard
    document.body.innerHTML = `
        <div id="layout">
          <div class="main-button" id="plus"></div>
          <div class="main-button" id="minus"></div>
          <div class="main-button" id="layer"></div>
          <div class="main-button" id="locate"></div>
          <div class="main-button" id="select-course"></div>
          <div class="main-button" id="show-settings"></div>
          <div id="map"></div>
          <div id="settings">
              <div id="console"></div>
          </div>
          <div id="score-row">
              <table class="scorecard"><tr class="hole-number"><tr class="hole-score"></table>
              <table class="scorecard"><tr class="hole-number"><tr class="hole-score"></table>
              <table id="score-total">
                  <tr class="total-heading">
                      <td colspan=2>out</td>
                      <td colspan=2>in</td>
                      <td colspan=2>total</td>
                  </tr>
                  <tr class="total-score">
                      <td id="out-score"></td> <td id="out-to-par"></td>
                      <td id="in-score"></td>  <td id="in-to-par"></td>
                      <td id="total-score"></td> <td id="total-to-par"></td>
                  </tr>
              </table>
          </div>
        </div>
    `
    const layoutElt = document.querySelector("#layout")
    const mapElt = document.querySelector("#map")
    const scorecardElt = document.querySelector("#scorecard")
    const locateElt = document.querySelector("#locate")

    await loadMap(mapElt)
    await manageSettings()
    await manageScorecard()
    await manageLocation()
    await manageCourses()

    foo()
}


// parse parameters
const url = new URL(document.baseURI)
if (url.searchParams.has("testLoc")) {
    // testLoc sets lastLoc which disables watchPosition
    const [lat, lon] = url.searchParams.get("testLoc").split(",")
    lastLoc = {coords: {latitude: Number(lat), longitude: Number(lon), accuracy: 10}} 
    print(lastLoc)
}

show()


