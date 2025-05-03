"use strict";

const holeZoom = 17
const courseZoom = 15
const selectCourseZoom = 11
const maxZoom = 20

const appPage = "golf.html"
const tourPage = "golf.html?tour"


////////////////////////////////////////////////////////////
//
// utility
//

function divLog(kind, ...args) {
    const consoleElt =  document.querySelector("#console")
    if (consoleElt) {
        const elt = document.createElement("div")
        elt.classList.add("console-" + kind)
        elt.innerText = args.join(" ")
        consoleElt.appendChild(elt)
        elt.scrollIntoView()
    }
}

function intercept(fun) {
    var oldFun = console[fun]
    console[fun] = (...args) => {
        oldFun(...args)
        divLog(fun, ...args)
    }
}

// intercept stuff to send it to our console element
for (const fun of ["log", "info", "warning", "error", "trace", "debug"])
    intercept(fun)
window.onerror = e => divLog("error", e)
window.onunhandledrejection = e => divLog("error", e.reason.stack)


const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

// return current pos
var lastPos
async function getPos() {
    if (lastPos) {
        // use last reported by watchPosition
        return lastPos;
    } else {
        // otherwise ask
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy: true})
        })
        return pos
    }
}

// turf point from various other representations
function turfPoint(ll) {
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
function turfDistance(a, b) {
    return turf.distance(turfPoint(a), turfPoint(b), {units: "meters"})
}

// TODO: use divIcon instead
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
        //className: "svg-icon",
    })
    return icon
}

function divIcon(className) {
    const icon = L.divIcon({
        html: `<div class="${className}"></div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
    })
    return icon
}



////////////////////////////////////////////////////////////
//
// app tour
//
// TODO: add steps for: pan, zoom
// TODO: create messages area, part of settings (so it can move buttons down) but always visible
//       addMessage (with optional timeout), removeMessage
// TODO: make tour div part of messages
// TODO: add message for loading courses
//

const btn = name => `<div class='main-button tour-icon ${name}'></div>`
const hand = "<span style='font-size: 120%'>👈</span>"
const tourSteps = [{
    latlon: [41.31925403108735, -73.89320076036483],
    text: `
        Welcome to the tour. Click on this box any time to end the tour
        and use the app.
        <br/><br/>
        The app has detected that you are at your course.
        The ${btn('crosshair-icon')} marker shows your current location.
        <br/><br/>
        Click hole 1 on scorecard to zoom in.
    `, 
    waitFor: "selectHole-1"
}, {
    text: `
        Click on the fairway to create a marker.
    `, 
    waitFor: "addMarker"
}, {
    text: `
        The info box shows actual distance, elevation change, and plays-like distance.
        <br/><br/>
        Click on the green to add a marker to the path.
    `, 
    waitFor: "addMarker"
}, {
    text: `Drag one of the markers to move it.`, 
    waitFor: "moveMarker",
}, {
    text: `
        Click the marker on the fairway to delete it so we can see whether
        Rory McIlroy can reach the green in one.`,
    waitFor: "removeMarker"
}, {
    text: `
        You made par! Enter your score by clicking ${btn('plus-button')} four times.
        <br/><br/>
        You can enter your score after the hole, or use the plus button like
        a score clicker as you go.
    `,
    waitFor: "updateScore-4"
}, {
    text: `
        Now swipe left ${hand} on the scorecard once to see the back nine,
        and again ${hand} to see your total score.
    `,
    waitFor: "scrollTo-score-total",
}, {
    text: `
        Well done - even par for the round!
        But somehow you aren't tired yet,
        so click ${btn('select-course-button')} to check out other courses.
    `,
    waitFor: "selectCourse"
}, {
    text: `
        That concludes the tour. Click here to use the app.
        You can rerun the tour any time by clicking ${btn('show-settings-button')}
    `,
    waitFor: null
}]

var tourStep = -1

async function startTour() {
    tourStep = 0
    await updateTour()
}

async function updateTour() {
    const tourElt = document.querySelector("#tour")
    if (0 <= tourStep && tourStep < tourSteps.length) {
        const step = tourSteps[tourStep]
        tourElt.innerHTML = step.text
        if (step.latlon) {
            const pos = {coords: {latitude: step.latlon[0], longitude: step.latlon[1], accuracy: 0}}
            await moveLocationMarker(pos, false)
        }
    } else {
        tourStep = -1
        tourElt.style.display = "none"
    }
}

async function endTour() {
    window.location = appPage
}

async function didAction(name) {
    if (tourStep >= 0) {
        const step = tourSteps[tourStep]
        if (step.waitFor == name) {
            tourStep += 1
            await updateTour()
        }
    }
}

async function manageTour() {

    // return if not doing tour?
    const url = new URL(document.baseURI)
    if (!url.searchParams.has("tour"))
        return

    // show tour box
    const mapElt = document.querySelector("#map")
    const tourElt = document.createElement("div")
    tourElt.id = "tour"
    tourElt.addEventListener("click", (e) => {
        endTour()
        e.stopPropagation()
    })
    mapElt.appendChild(tourElt)

    // kick it off
    await startTour()
}


////////////////////////////////////////////////////////////
//
// set up our map using Leaflet
//

var theMap
var keys

async function manageMap(elt) {

    // access keys from local file, if any
    try {
        const response = await fetch("keys.yaml")
        const text = await response.text()
        keys = jsyaml.load(text)
    } catch (e) {
        print("keys not available:", e.reason)
        keys = {}
    }

    // USGS maps
    // not high enough res
    function USGS(type, maxNativeZoom=16) {
        const url = `https://basemap.nationalmap.gov/arcgis/rest/services/${type}/MapServer/tile/{z}/{y}/{x}`
        const attrURL = "https://basemap.nationalmap.gov/arcgis/rest/services"
        const attribution = `<a href='${attrURL}' target='_blank'>USGS</a>`
        return L.tileLayer(url, {attribution, maxZoom, maxNativeZoom})
    }

    // seems to cache for 12h
    // requires account and key
    // 200k per month free, billed after that
    function mapBox(style) {
        const url = `https://api.mapbox.com/styles/v1/${style}/tiles/{z}/{x}/{y}{r}?access_token=${keys.MapBox}`
        const attribution = "©<a href='https://www.mapbox.com' target='_blank'>MapBox</a>"
        return L.tileLayer(url, {attribution, maxZoom})
    }

    // seems to cache for 4h
    // 100k free per month free, hard limit (?)
    // can limit by domain (?)
    function mapTiler() {
        const url = `https://api.maptiler.com/maps/satellite/{z}/{x}/{y}{r}.jpg?key=${keys.MapTiler}`
        const attribution = "©<a href='https://www.maptiler.com' target='_blank'>MapTiler</a>"
        return L.tileLayer(url, {attribution, maxZoom})
    }

    // not sure how long it caches - max-age headers are complicated
    // free to use, with attribution, in reasonable volume
    function OSM() {
        const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        const attribution = "©<a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>"
        return L.tileLayer(url, {attribution, maxZoom, maxNativeZoom: 19})
    }

    // seems to cache for 24h
    // public, no key
    // actually goes to zoom 20, but that switches to a less appealing set of imagery
    function ESRI() {
        const url = "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        const attribution = "©<a href='https://www.esri.com/copyright' target='_blank'>Esri</a>"
        return L.tileLayer(url, {attribution, maxZoom, maxNativeZoom: 19})
    }

    // these will be presented in the layer switch control
    const baseMaps = [

        OSM(),
        ESRI(),

        // these are less desirable, but keep as backup for future reference
        //mapBox("mapbox/satellite-streets-v12"),
        //mapTiler(),
        //USGS("USGSImageryOnly"),
    ]

    // create the map
    const mapElt = document.querySelector("#map")
    theMap = L.map(mapElt, {
        rotate: true,
        zoomSnap: 0.25,
        zoomControl: false,
        rotateControl: false,
    }).setZoom(selectCourseZoom)
    //theMap.on("zoomend", () => print("zoom", theMap.getZoom()))

    // our own layer switcher
    var currentLayerNumber = 0
    theMap.addLayer(baseMaps[currentLayerNumber])
    document.querySelector("#layer").addEventListener("click", () => {
        theMap.removeLayer(baseMaps[currentLayerNumber])
        currentLayerNumber = (currentLayerNumber + 1) % baseMaps.length
        print("switching to layer", currentLayerNumber)
        theMap.addLayer(baseMaps[currentLayerNumber])
    })

    // set up location and accuracy marker, and polyline
    const icon = divIcon("crosshair-marker")
    locationMarker = L.marker([0,0], {icon}).addTo(theMap)
    accuracyMarker = L.circle([0,0], {className: "accuracy"}).addTo(theMap)
    pathLine = L.polyline([], {className: "path-line"}).addTo(theMap)
}


////////////////////////////////////////////////////////////
//
// elevation data
//

const elevationTileCache =  new Map()

// common elevation code
// compute fractional tile number from lat,lon
// then call specialized getEl function
async function getEl(lat, lon, el) {

    // compute fractional tile fx,fy and integer tile x,y
    const d2r = Math.PI / 180
    const sin = Math.sin(lat * d2r)
    const z2 = Math.pow(2, el.z)
    const fx = z2 * (lon / 360 + 0.5)
    const fy = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI)
    return el.getEl(fx, fy, el)
}
    
// get elevation data from an image
// compute and fetch tile, load image, create ctx
// gen call specialized rgb2el function
async function getImgEl(fx, fy, el) {

    // get tile data
    const [x, y] = [Math.floor(fx), Math.floor(fy)]
    const key = x + "," + y + "," + el.z
    if (!elevationTileCache.has(key)) {

        // fetch tile into an image element
        print("fetching elevation tile", key)
        const img = new Image()
        img.crossOrigin = 'Anonymous' // Needed for pixel access
        img.src = el.xyz2url(x, y, el.z)
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
        })
        if (img.width != el.tileSize)
            throw `img.width ${img.width} does not match tileSize ${el.tileSize}`

        // draw image in offscreen canvas
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = el.tileSize
        const ctx = canvas.getContext("2d", {willReadFrequently: true})
        ctx.drawImage(img, 0, 0)
        elevationTileCache.set(key, ctx)
    }
    const ctx = elevationTileCache.get(key)
    
    // extract elevation data from canvas
    const [px, py] = [Math.floor((fx - x) * el.tileSize), Math.floor((fy - y) * el.tileSize)]
    const [r, g, b] = ctx.getImageData(px, py, 1, 1).data
    const elevation = el.rgb2el(r, g, b)
    return elevation
}

// get elevation data from an esri lerc file
// fetch the file, decode it using esri library,
// compute pixel coordinates, return pixel
async function getLercEl(fx, fy, el) {

    // load decoder
    await Lerc.load()

    // get tile data
    const [x, y] = [Math.floor(fx), Math.floor(fy)]
    const key = x + "," + y + "," + el.z
    if (!elevationTileCache.has(key)) {
        print("fetching elevation tile", key)
        const url = el.xyz2url(x, y, el.z)
        const response = await fetch(url)
        const buffer = await response.arrayBuffer()
        const data = Lerc.decode(buffer)
        elevationTileCache.set(key, data)
    }
    const data = elevationTileCache.get(key)
    
    // extract elevation data
    // note use of round instead of floor because of extra row/col of pixels
    // TODO: off by one or one-half?
    const tileSize = data.width - 1 // ESRI elevation tiles have an extra row/col
    const [px, py] = [Math.round((fx - x) * tileSize), Math.round((fy - y) * tileSize)]
    const offset = py * data.width + px
    return data.pixels[0][offset]
}

// relatively low resolution, and data seems to be old - does not have some HBGC features
// https://www.reddit.com/r/gis/comments/lg3fqa/are_there_any_dem_tile_servers_out_there/
// uses my api key, could get billed
const mapboxEl = {
    xyz2url: (x, y, z) =>
        `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${keys.MapBox}`,
    getEl: getImgEl,
    rgb2el: (r, g, b) => (r * 256 * 256 + g * 256 + b) * 0.1 - 10000,
    tileSize: 256,
    z: 15
}

// relatively low resolution, and data seems to be old - does not have some HBGC features
// https://github.com/tilezen/joerd/blob/master/docs/formats.md
// https://aws.amazon.com/blogs/publicsector/announcing-terrain-tiles-on-aws-a-qa-with-mapzen/
const mapzenEl = {
    xyz2url: (x, y, z) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
    getEl: getImgEl,
    rgb2el: (r, g, b) => (r * 256 + g + b / 256) - 32768,
    tileSize: 256,
    z: 15
}

// this seems to be good data compared to other sources at HBGC
// https://developers.arcgis.com/documentation/tiled-elevation-service/
// https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer
// https://app.unpkg.com/lerc@4.0.4/files/README.md
// at mazimum zoom level 16:
//     about 600 m square, 2.4 m / pixel
//     seem to generally be around 30-40k bytes
//     max-age returned by server: 24h
const esriEl = {
    xyz2url: (x, y, z) =>
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D" +
        `/ImageServer/tile/${z}/${y}/${x}`,
    getEl: getLercEl,
    z: 16
}
    

// Esri elevation data seems to be the best
const getElevation = (lat, lon) => getEl(lat, lon, esriEl)

// these are less desirable, but keep for future reference
//const getElevation = (lat, lon) => getEl(lat, lon, mapboxEl)
//const getElevation = (lat, lon) => getEl(lat, lon, mapzenEl)


async function getMarkerElevation(marker) {
    const ll = marker.getLatLng()
    return getElevation(ll.lat, ll.lng)
}


////////////////////////////////////////////////////////////
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
        settingsElt.insertBefore(itemElt, document.querySelector("#status"))
        itemElt.addEventListener("click", action)
        // closing is handled by event propagationg to settingsElt
    }

    // help button
    addSetting("Take the tour", () => {
        window.location = tourPage
    })

    // clear course data button
    addSetting("Refresh course data", () => {
        print("clearing local storage")
        localStorage.clear()
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
    settingsElt.addEventListener("click", toggleSettings)
}


////////////////////////////////////////////////////////////
//
// scorecard, selected hole
//

var selectedHole
var selectedHoleLayer
var holeFeatures = []

async function selectHole(holeNumber) {

    print("selectHole", holeNumber)

    // update tour
    didAction("selectHole-" + holeNumber)

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

    // advance tour on scorecard scroll
    document.querySelector("#score-row").addEventListener("scrollsnapchange", (e) => {
        didAction("scrollTo-" + e.snapTargetInline.id)
    })

    // add or subtract one from score
    function updateScore(holeNumber, update) {

        // update hole score
        const td = document.querySelector(`#hole-score-${holeNumber}`)        
        const newScore = Number(td.innerText) + update
        td.innerText = newScore > 0? String(newScore) : " "

        // advance tour
        didAction("updateScore-" + newScore)

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
async function updateLine() {

    // update the polyline
    const useMarkers = pathMarkers.filter(m => m!=locationMarker || theMap.getBounds().contains(m.getLatLng()))
    const lls = useMarkers.map(m => m.getLatLng())
    pathLine.setLatLngs(lls)
    
    // update the distance info
    for (const m of pathMarkers)
        m.unbindTooltip()
    for (var i = 1; i < useMarkers.length; i++) {
        const [m1, m2] = [useMarkers[i-1], useMarkers[i]]
        const distanceYd = turf.distance(turfPoint(m1), turfPoint(m2), {units: "yards"})
        const elChangeFt = ((await getMarkerElevation(m2)) - (await getMarkerElevation(m1))) * 3.28084
        const playsLikeYd = distanceYd + elChangeFt / 3
        const tip = `
            ${Math.round(distanceYd)} yd <br/>
            ${elChangeFt >= 0? "+" + Math.round(elChangeFt) : Math.round(elChangeFt)} ft <br/>
            ${Math.round(playsLikeYd)} yd <br/>
        `
        m2.bindTooltip(tip, {
            permanent: true,
            direction: "right",
            offset: L.point([15, 0]),
            className: "distance-info"
        })
    }

    // make sure we're in front of course features
    try {
        pathLine.bringToFront()
    } catch (e) {
        // TODO: in tour mode this fails initially - why?
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
async function moveLocationMarker(pos, center) {

    // update location and accuracy marker, and optionally center view if requested
    // also remember this position as lastPos, and update the path
    const latlon = [pos.coords.latitude, pos.coords.longitude]
    locationMarker.setLatLng(latlon)
    accuracyMarker.setLatLng(latlon)
    accuracyMarker.setRadius(pos.coords.accuracy) // units provided and units expected are both meters
    if (center)
        theMap.setView(latlon)
    lastPos = pos
    updateLine()

    // report DEM and GPS elevation for investigation
    // GPS elevation not good enough to be useful
    // but keep this code for future reference
    /*
    const demEl = await getElevation(...latlon)
    const gpsEl = pos.coords.altitude
    const gpsElAcc = pos.coords.altitudeAccuracy
    if (gpsEl && gpsElAcc) {
        const delta = (gpsEl - demEl) * 3.28084
        const msg = `
            dem: ${demEl.toFixed(1)} m &emsp; | &emsp;
            gps: ${gpsEl.toFixed(1)}±${gpsElAcc.toFixed(1)} m &emsp; | &emsp;
            delta: ${delta.toFixed(1)} ft
        `
        document.querySelector("#status").innerHTML = msg
    }
    */
}

// center the current location in the map and reset markers
async function goToCurrentLocation(userAction = false) {
    
    // advance tour
    if (userAction)
        didAction("goToCurrentLocation")

    // center on current position
    const pos = await getPos()
    moveLocationMarker(pos, true)
    
    // remove other markers
    resetPath()
}

function fakeLocation(lat, lon) {
    lastPos = {coords: {
        // meters
        latitude: Number(lat), longitude: Number(lon), accuracy: 100,
        altitude: 123.456, altitudeAccuracy: 34.56
    }}
    print("using fake location", lastPos)
}

async function manageLocation() {
    
    // watch for position changes, or use fake position
    const url = new URL(document.baseURI)
    if (url.searchParams.has("testPos")) {
        const [lat, lon] = url.searchParams.get("testPos").split(",")
        fakeLocation(lat, lon)
    }

    // if lastPos is already set then we are using a fake location so don't watch
    if (!lastPos) {
        // watch for position changes, and update locationMarker accordingly
        // this does not center the locationMarker
        lastPos = getPos()
        print("watching for postion changes")
        navigator.geolocation.watchPosition(
            (pos) => moveLocationMarker(pos, false),
            print,
            {enableHighAccuracy: true, timeout: 1000}
        )
    }

    // locate button moves map to current location
    // TODO: redo using svg for consistency with map location icon (?)
    const locateButton = document.querySelector("#locate")
    locateButton.addEventListener("click", () => goToCurrentLocation(true))

    // clicking on map adds a marker
    // TODO: use svgUrlIcon, and design it so that viewBox is the grab area
    // or use a containing div for grab area?
    const markerIcon = svgIcon("<circle>", "path-marker")
    theMap.on("click", function(e) {

        // create marker
        const marker = L.marker(e.latlng, {
            icon: markerIcon,
            draggable: true,
            autoPan: false,
            autoPanOnFocus: false, // https://github.com/Raruto/leaflet-rotate/issues/28
        }).addTo(theMap)
        pathMarkers.push(marker)
        didAction("addMarker")

        // redraw line and update distance info to include new marker
        updateLine()

        // clicking marker removes it
        marker.on("click", () => {
            marker.remove()
            pathMarkers = pathMarkers.filter(m => m !== marker)
            updateLine()
            didAction("removeMarker")
        })

        // dragging marker updates line
        marker.on("drag", (e) => {
            //print("drag")
            updateLine()
            didAction("moveMarker")
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
var courseMarkerLayer

// do an Overpass query against OSM data
async function query(query) {

    const fullQuery = `
        [out:json][timeout:25];
           ${query}
        out body;
        >;
        out skel qt;
    `
    const api = "https://overpass-api.de/api/interpreter"
    const response = await fetch(api, {method: "POST", body: fullQuery,})
    try {
        const responseJSON = await response.json()
        const geojson = osmtogeojson(responseJSON)
        return geojson
    } catch(e) {
        print(response.text())
    }
}

async function queryCourseFeatures(name, latlon) {

    const [lat, lon] = latlon

    // query language doesn't support querying for features within a polygon
    // so instead query for all features within a certain distance, then filter
    //
    // TODO: the "nwr" for fairways picks up relations, which are used to group the
    // outer and inner loops of fairways that surround greens. Do we need to do this
    // for any of the other feature types as well? These seem to come through from
    // osm2geojson as features with geometry.coordinates.length>1 (i.e. muliple loops)
    // and also properties.type=="multipolygon" (although probably just the multiple loops
    // is sufficient for it to be displayed correctly)
    //
    const distance = 5000
    const featuresQuery = `
        (
           way[golf="hole"](around:${distance},${lat},${lon});
           way[golf="tee"](around:${distance},${lat},${lon});
           nwr[golf="fairway"](around:${distance},${lat},${lon});
           way[golf="bunker"](around:${distance},${lat},${lon});
           way[golf="green"](around:${distance},${lat},${lon});
           way[name='${name}']; // this picks up course boundaries
        );
    `
    const features = await query(featuresQuery)

    // find the course bounds among the query results
    // generally should be fast as it appears course bounds will be first
    // I guess because it was last in the query?
    var courseBounds
    for (const feature of features.features) {
        if (feature.properties.name == name) {
            courseBounds = feature.geometry
            break
        }
    }

    // now filter the features we found within a certain radius of the course
    // to include only those actually within the course bounds
    // we do this filtering here so it gets cached
    function onCourse(feature) {
        if (feature.properties.leisure == "golf_course") {
            // don't want the course bounds in this feature list
            return false
        } if (feature.geometry.type == "Polygon") {
            // tee, bunker, fairway, green
            if (feature.geometry.coordinates.length > 1)
                print("features has multiple loops", feature)
            for (const loop of feature.geometry.coordinates)
                for (const point of loop)
                    if (turf.booleanPointInPolygon(point, courseBounds))
                        return true
        } else if (feature.geometry.type == "LineString") {
            // hole is defined by a linestring
            for (const point of feature.geometry.coordinates)
                if (turf.booleanPointInPolygon(point, courseBounds))
                    return true
        } else {
            print("unknown feature geometry type", feature.geometry.type)
        }
        print("excluding", feature)
        return false
    }
    const ownFeatures = features.features.filter(onCourse)
    return ownFeatures;
}

function shorten(name) {
    var words = name.split(" ")
    words = words.filter(word => /^[A-Z]/.test(word))
    words = words.filter(word => !["Golf", "Course", "Club", "Country", "Center"].includes(word))
    const short_name = words.map(word => word.slice(0, 1)).join("")
    return short_name
}

async function queryCourses(south, west, north, east) {
    const q = `way[leisure=golf_course](${south},${west},${north},${east});`
    const courses = await query(q)
    const result = {}
    for (const course of courses.features) {
        const center = turf.centroid(course)
        const [lon, lat] = center.geometry.coordinates
        if (course.properties.name)
            course.properties.short_name = shorten(course.properties.name)
        result[course.properties.name] = [lat, lon]
    }
    return result
}

async function cacheJSON(key, fun) {
    var value = localStorage.getItem(key)
    if (value) {
        print("using cached data for", key)
        return JSON.parse(value);
    } else {
        print("querying for", key)
        value = await fun()
        localStorage.setItem(key, JSON.stringify(value));
        return value
    }
}

var knownCourses = {}

// TODO: clear course markers?
async function loadCourse(name) {

    // get course data
    const latlon = knownCourses[name]
    const courseFeatures = await cacheJSON(name, () => queryCourseFeatures(name, latlon))

    // group features by nearest hole into holeFeatures array
    // holeFeatures is indexed by hole number,
    // and each element is an array of features associated with that hole
    // first element of each array is the hole feature (line representing hole) itself
    //
    // TODO: this doesn't really work quite right
    // BUG? see e.g. James Baird State Park - 16 fairway is assigned to hole 1

    // first get the hole feature (line representing hole)
    holeFeatures = []
    for (const feature of courseFeatures) {
        if (feature.properties.golf == "hole") {
            // other code depends on the "hole" feature being first in the features array
            const holeNumber = feature.properties.ref
            holeFeatures[holeNumber] = [feature]
        }
    }

    // then for each non-hole feature associate it with the closest hole
    for (const feature of courseFeatures) {
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
            if (minHoleNumber)
                holeFeatures[minHoleNumber].push(feature) 
        }
    }

    // show the course
    print("setview", latlon)
    theMap.setView(latlon, courseZoom)

    // no longer in course select mode
    courseMarkerLayer.remove()
}

// put up markers to select courses centered around current location
async function selectCourse(userAction) {

    // update tour
    if (userAction)
        didAction("selectCourse")

    // clean slate
    if (courseMarkerLayer)
        courseMarkerLayer.remove()
    courseMarkerLayer = L.layerGroup().addTo(theMap)
    holeFeatures = []
    resetPath()
    theMap.setBearing(0)
    theMap.setZoom(selectCourseZoom)
    if (theMap.getZoom() != selectCourseZoom) {
        print("awaiting zoomend")
        await new Promise((resolve, reject) => {theMap.on("zoomend", resolve)})
        print("zoomend")
    }

    // snap to tile boundaries
    const tileSize = 0.25 // needs to be power of 2
    const dn = x => Math.floor(x/tileSize)*tileSize
    const up = x => Math.floor((x+tileSize)/tileSize)*tileSize

    // compute bounding box snapped to tiles of size tileSize deg
    const bounds = theMap.getBounds()
    const south = dn(bounds.getSouth())
    const west = dn(bounds.getWest())
    const north = up(bounds.getNorth())
    const east = up(bounds.getEast())

    // iterate over tiles adding markers
    const pos = await getPos()
    for (var s = south; s < north; s += tileSize) {
        for (var w = west; w < east; w += tileSize) {
            const n = s + tileSize
            const e = w + tileSize
            const key = s + "," + w + "," + n + "," + e
            const courses = await cacheJSON(key, () => queryCourses(s, w, n, e))
            Object.assign(knownCourses, courses)
            for (const [courseName, latlon] of Object.entries(courses)) {
                var shortName = shorten(courseName)
                if (shortName.length > 2)
                    shortName = shortName.slice(0, 2) + "<br/>" + shortName.slice(2)
                const icon = L.divIcon({
                    html: `<div class="course-icon"><div>${shortName}</div></div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                })
                const marker = L.marker(latlon, {icon}).addTo(theMap).on("click", () => {
                    loadCourse(courseName, latlon)
                }).addTo(courseMarkerLayer)
            }
        }
    }
}

async function loadNearbyCourse(distance = 1000) {
    const pos = await getPos()
    for (const [courseName, latlon] of Object.entries(knownCourses)) {
        if (turfDistance(pos, latlon) < distance) {
            await loadCourse(courseName)
            return
        }
    }
}

async function manageCourses()  {

    const selectCourseButton = document.querySelector("#select-course")
    selectCourseButton.addEventListener("click", () => selectCourse(true))

    // this is our initial action
    await selectCourse(false)
    await loadNearbyCourse()
}


////////////////////////////////////////////////////////////
//
// entry point
//

async function show() {

    // TODO: move score-row to manageScorecard
    document.body.innerHTML = `
        <div id="layout">
          <div class="main-button show-settings-button" id="show-settings"></div>
          <div class="main-button select-course-button" id="select-course"></div>
          <div class="main-button locate-button" id="locate"></div>
          <div class="main-button layer-button" id="layer"></div>
          <div class="main-button minus-button" id="minus"></div>
          <div class="main-button plus-button" id="plus"></div>
          <div id="map"></div>
          <div id="settings">
              <div id="status"></div>
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

    try {
        await manageMap()
        await manageSettings()
        await manageScorecard()
        await manageTour()
        await manageLocation()
        await manageCourses()
    } catch (e) {
        // e.g. location service not available
        // TODO use a message box?
        print("error", e.message)
        const mapElt = document.querySelector("#map")
        mapElt.innerText = e.message
        mapElt.classList.add("error")
    }
}

show()
