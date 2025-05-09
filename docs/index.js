// © 2025 Bruce D. Lucas https://github.com/bdlucas1
// SPDX-License-Identifier: AGPL-3.0

"use strict";

const holeZoom = 17
const courseZoom = 15
const selectCourseZoom = 11
const maxZoom = 20

const aboutPage = "https://github.com/bdlucas1/ace/blob/main/README.md"

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
        if (oldFun)
            oldFun(...args)
        divLog(fun, ...args)
    }
}

// intercept stuff to send it to our console element
for (const fun of ["log", "info", "error", "warning", "trace", "debug"])
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
        try {
            const pos = await new Promise((resolve, reject) => {
                const options = {enableHighAccuracy: true, timeout: 5000}
                navigator.geolocation.getCurrentPosition(resolve, reject, options)
            })
            return pos
        } catch(e) {
            const message = `
                ${e.message}
                <br/><br/>
                You may need to enable location services for your browser.
                <br/><br/>
                iPhone: Settings | Privacy & Security | Location Services
                <br/><br/>
                Android: Settings | Location | App location permissions
                <br/><br/>
                The browser will then ask you if it is ok to give this app your location,
            `
            print("e", e)
            showMessage(message)
            throw Error()
        }
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

// see usage below for example
// call sharedFetch instead of fetch to deduplicate fetches
// when the promise resolves and the data is cached then
// the caller can delete the url from sharedFetchPromises
var sharedFetchPromises = {}
function sharedFetch(url) {
    if (!sharedFetchPromises[url])
        sharedFetchPromises[url] = fetch(url)
    return sharedFetchPromises[url]
}


////////////////////////////////////////////////////////////
//
// queries
//

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
        print(e)
        //print(response.text())
    }
}

async function cacheJSON(key, fun) {
    var value = localStorage.getItem(key)
    if (value) {
        print("using cached data for", key)
        return JSON.parse(value);
    } else {
        print("querying for", key)
        const msgElt = showMessage("Hang on, fetching course data...")
        value = await fun()
        localStorage.setItem(key, JSON.stringify(value));
        removeMessage(msgElt)
        return value
    }
}

function setAppState(key, value) {
    var appState = JSON.parse(localStorage.getItem("appState")) || {}
    appState[key] = value
    localStorage.setItem("appState", JSON.stringify(appState))
    print(`ApppState(${key},${value}); state is now`, JSON.stringify(appState))
}

function getAppState(key, value) {
    var appState = JSON.parse(localStorage.getItem("appState")) || {}
    print(`getApppState(${key}); state is`, JSON.stringify(appState))
    return appState[key]
}


////////////////////////////////////////////////////////////
//
// tutorial
//


var tutorialElt
var sawFinalMessage = false

async function startTutorial() {

    tutorialElt = document.createElement("div")
    tutorialElt.classList.add("tutorial")
    document.querySelector("#messages").appendChild(tutorialElt)

    // prevent clicks on tutorial from toggling settings
    tutorialElt.addEventListener("click", e => e.stopPropagation())

    // watch for step to become newly visible and run its setup, if any
    const observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
            if (entry.isIntersecting && entry.target.tutorialSetup) {
                print(entry.target.id, "became visible; running its setup")
                entry.target.tutorialSetup()
            }
        })
    })

    // the tutorial div has a horizontal array of step divs of various heights
    // we want the map to handle events outside of the step elements, but the tutorial element captures some of them
    // so we catch events on the empty part of the tutorial container element
    // and re-dispatch them to the map underneath
    const eventNames = ["click", "touchstart", "touchend", "touchmove", "mousedown", "mouseup", "mousemove"]
    for (const eventName of eventNames) {
        tutorialElt.addEventListener(eventName, e => {
            if (e.target == tutorialElt) {
                const pos = e.changedTouches && e.changedTouches[0] || e.targetTouches && e.targetTouches[0] || e
                const originalPointerEvents = tutorialElt.style.pointerEvents
                try {
                    tutorialElt.style.pointerEvents = "none";
                    const underneath = document.elementFromPoint(pos.clientX, pos.clientY)
                    const newEvent = new e.constructor(e.type, e)
                    underneath.dispatchEvent(newEvent)
                } finally {
                    tutorialElt.style.pointerEvents = originalPointerEvents
                }
            }
        })
    }

    // redispatch scroll wheel events to map for zooming
    const mapElt = document.querySelector("#map")
    tutorialElt.addEventListener("wheel", e => {
        if (e.deltaX == 0) {
            const newEvent = new e.constructor(e.type, e)
            mapElt.dispatchEvent(newEvent)
            e.stopPropagation()
        }
    })

    // generate a div for each step and add it to the tutorial div
    var stepNumber = 0
    for (const step of tutorialSteps) {
        const stepElt = document.createElement("div")
        stepElt.id = "tutorial-step-" + stepNumber++
        stepElt.classList.add("message")
        stepElt.innerHTML = `<div class='closer'></div>${step.text}`
        stepElt.querySelector(".closer").addEventListener("click", endTutorial);
        //stepElt.addEventListener("click", (e) => e.stopPropagation())
        stepElt.tutorialSetup = step.setup
        observer.observe(stepElt)
        tutorialElt.appendChild(stepElt)
        tutorialElt.onmessageclose = endTutorial
    }

    // run setup for first step early which sets lastPos which disables position watcher
    // TODO: is there a better way to do this? this causes first tutorial step setup to be run twice.
    print("running setup for tutorial step 0 to set lastPos")
    tutorialSteps[0].setup()
}

async function didAction(name) {
    print("didAction", name)
    document.querySelectorAll(".action." + name).forEach(e => {
        e.classList.add("completed")
    })
}

function clearActions(...actions) {
    for (const action of actions) {
        document.querySelectorAll(".action." + action).forEach(e => {
            e.classList.remove("completed")
        })
    }
}

async function endTutorial() {
    setAppState("didTutorial", true)
    if (sawFinalMessage)
        window.location = "."
    else
        tutorialElt.lastElementChild.scrollIntoView({behavior: "instant"})
}

async function manageTutorial() {
    const url = new URL(document.baseURI)
    if (!getAppState("didTutorial") || url.searchParams.has("tutorial")) {
        // load tutorial and start it
        // do this synchronously to ensure startTutorial is done before we proceed
        const tutorialScript = document.createElement("script")
        tutorialScript.src = "tutorial.js"
        const loaded = new Promise(resolve => tutorialScript.onload = resolve)
        document.head.appendChild(tutorialScript)
        await loaded
        startTutorial()
    }
}


////////////////////////////////////////////////////////////
//
// set up our map using Leaflet
//

var theMap
var keys
var layerMaps
var currentLayerNumber = 0

function switchToLayer(layerNumber) {
    theMap.removeLayer(layerMaps[currentLayerNumber])
    currentLayerNumber = layerNumber
    print("switching to layer", currentLayerNumber)
    theMap.addLayer(layerMaps[currentLayerNumber])
}


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
    layerMaps = [

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
    theMap.on("zoomstart", () => didAction("zoom"))
    theMap.on("dragstart", () => didAction("pan"))

    // our own layer switcher
    theMap.addLayer(layerMaps[currentLayerNumber])
    document.querySelector("#layer").addEventListener("click", () => {
        switchToLayer((currentLayerNumber + 1) % layerMaps.length)
        didAction("layer")
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
// TODO: we're not doing a fetch here so can't use sharedFetch - is that a problem?
// (but not using this at the moment anyway)
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
        const response = await sharedFetch(url)
        const buffer = await response.arrayBuffer()
        const data = Lerc.decode(buffer)
        elevationTileCache.set(key, data)
        delete sharedFetchPromises[url]
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
// TODO: see note above about the use of img and sharedFetch
// if reinstated check whether multiple fetches for same tile while dragging
// is an issue
//const getElevation = (lat, lon) => getEl(lat, lon, mapboxEl)
//const getElevation = (lat, lon) => getEl(lat, lon, mapzenEl)


async function getMarkerElevation(marker) {
    const ll = marker.getLatLng()
    return getElevation(ll.lat, ll.lng)
}


////////////////////////////////////////////////////////////
//
// settings menu
//

function showMessage(html, timeMs=0) {

    const msgElt = document.createElement("div")
    msgElt.classList.add("message")
    msgElt.addEventListener("click", (e) => e.stopPropagation())
    updateMessage(msgElt, html)

    const messagesElt = document.querySelector("#messages")
    messagesElt.appendChild(msgElt)

    if (timeMs)
        setTimeout(() => removeMessage(msgElt), timeMs)

    return msgElt
}

function updateMessage(msgElt, html) {
    msgElt.innerHTML = `<div class='closer'></div>${html}`
    msgElt.querySelector(".closer").addEventListener("click", () => removeMessage(msgElt))
}

function removeMessage(msgElt) {
    const parent = msgElt.parentElement
    if (parent)
        parent.removeChild(msgElt)
    if (msgElt.onmessageclose)
        msgElt.onmessageclose(msgElt)
}

async function manageSettings() {

    // set up settings menu
    const settingsElt = document.querySelector("#settings")
    const consoleElt = document.querySelector("#console")
    function addSetting(text, action) {
        const itemElt = document.createElement("div")
        itemElt.innerText = text
        itemElt.classList.add("settings-button")
        settingsElt.insertBefore(itemElt, consoleElt)
        itemElt.addEventListener("click", action)
        // closing is handled by event propagationg to settingsElt
    }

    // console collapse/expand
    consoleElt.addEventListener("click", (e) => {
        if (consoleElt.classList.contains("collapsed")) {
            consoleElt.classList.remove("collapsed")
            consoleElt.scrollTo(0, consoleElt.scrollHeight);
        } else {
            consoleElt.classList.add("collapsed")
        }
        e.stopPropagation()
    })
    consoleElt.classList.add("collapsed")

    // About info
    addSetting("About", () => {
        window.location = aboutPage
    })

    // help button
    addSetting("Tutorial", () => {
        setAppState("didTutorial", false)
        window.location = "."
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

    // for testing
    //showMessage("message 1", 3000)
    //showMessage("message 2", 5000)
}


////////////////////////////////////////////////////////////
//
// scorecard, loaded hole
//

var loadedHoleNumber
var loadedHoleLayer

async function loadHole(holeNumber) {

    print("loadHole", holeNumber)

    // update tutorial
    didAction("loadHole")
    didAction("loadHole-" + holeNumber)

    // switch hole hole
    unloadHole()
    loadedHoleNumber = holeNumber

    // style selected hole on scorecard
    document.querySelector(`#hole-number-${loadedHoleNumber}`).classList.add("selected")
    document.querySelector(`#hole-score-${loadedHoleNumber}`).classList.add("selected")

    // do we have hole info to show?
    if (!loadedCourseHoleFeatures[holeNumber]) {
        print("no features")
        const pos = await getPos()
        if (await atCourse(pos, loadedCourseName))
            theMap.setView([pos.coords.latitude, pos.coords.longitude], holeZoom)
        return
    }

    // compute and set bearing from start to end of hole
    const feature = loadedCourseHoleFeatures[holeNumber][0]
    const coordinates = feature.geometry.coordinates
    const bearing = turf.bearing(coordinates[0], coordinates[coordinates.length - 1])
    await theMap.setBearing(-bearing)
    
    // select and show hole features
    loadedHoleLayer = L.geoJSON(loadedCourseHoleFeatures[holeNumber], {
        style: feature => {return {className: `golf-${feature.properties.golf}`}}
    }).addTo(theMap);

    // center hole on map
    const center = turf.center({type: "FeatureCollection", features: loadedCourseHoleFeatures[holeNumber]})
    const [lon, lat] = center.geometry.coordinates
    theMap.setView([lat, lon], holeZoom)
    resetPath()

}

function unloadHole() {
    if (loadedHoleNumber) {
        document.querySelector(`#hole-number-${loadedHoleNumber}`).classList.remove("selected")
        document.querySelector(`#hole-score-${loadedHoleNumber}`).classList.remove("selected")
        loadedHoleNumber = undefined
    }
    if (loadedHoleLayer) {
        theMap.removeLayer(loadedHoleLayer)
        loadedHoleLayer = undefined
    }
}

function resetScorecard() {
    const elt = document.querySelector("#score-row")
    elt.querySelectorAll(`td`).forEach(e => e.classList.remove("selected"))
    elt.querySelectorAll(".total-score td").forEach(e => e.innerText = "")
    elt.querySelectorAll(".hole-score td").forEach(e => e.innerText = "")
    elt.scrollLeft = 0
    unloadHole()
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
            td.addEventListener("click", function() {loadHole(Number(this.innerText))})
            table.querySelector(".hole-number").appendChild(td)

            // score cell
            td = document.createElement("td")
            td.id = `hole-score-${holeNumber}`
            td.holeNumber = holeNumber
            td.addEventListener("click", function() {loadHole(Number(this.holeNumber))})
            table.querySelector(".hole-score").appendChild(td)
        }
    })

    // advance tutorial on scorecard scroll
    /*
    // alas not available on safari  
    document.querySelector("#score-row").addEventListener("scrollsnapchange", (e) => {
        didAction("scrollTo-" + e.snapTargetInline.id)
    })
    */
    document.querySelector("#score-row").addEventListener("scroll", (e) => {
        const elt = document.querySelector("#score-row")
        const right = elt.getBoundingClientRect().right
        var lastVisibleId
        for (const e of elt.children) {
            const rect = e.getBoundingClientRect();
            if (rect.left + rect.width/2 < right)
                lastVisibleId = e.id
        }
        didAction("scrollTo-" + lastVisibleId)
    })

    // add or subtract one from score
    function updateScore(holeNumber, update) {

        // advance tutorial
        didAction(update > 0? "increaseScore" : "decreaseScore")

        // update hole score
        const td = document.querySelector(`#hole-score-${holeNumber}`)        
        const newScore = Number(td.innerText) + update
        td.innerText = newScore > 0? String(newScore) : " "


        // this assumes the "hole" feature is the first in the array of features for each hole
        // returns undefined if par is not available
        const parFor = holeNumber => {
            const features = loadedCourseHoleFeatures[holeNumber]
            if (!features || !features[0] || !features[0].properties)
                return undefined
            return features[0].properties.par
        }

        // update total score and total to par
        // toPar becomes NaN if par is unavailable for any hole,
        // which causes fmtPar to return blank
        function computeScore(start) {
            for (var holeNumber = start, total = 0, toPar = 0, i = 0; i < 9; i++, holeNumber++) {
                const score = Number(document.querySelector(`#hole-score-${holeNumber}`).innerText)
                total += score
                if (score > 0)
                    toPar += score - parFor(holeNumber)
            }
            return [total, toPar]
        }                
        const [outTotal, outToPar] = computeScore(1)
        const [inTotal, inToPar] = computeScore(10)

        const total = outTotal + inTotal
        const fmtToPar = toPar => toPar==0? "E": toPar>0? "+"+toPar : toPar<0? toPar : ""
        const toPar = inToPar + outToPar

        document.querySelector("#out-score").innerText = outTotal > 0? outTotal : ""
        document.querySelector("#in-score").innerText = inTotal > 0? inTotal : ""
        document.querySelector("#total-score").innerText = inTotal>0 && outTotal>0? total : ""

        document.querySelector("#out-to-par").innerText = outTotal>0? fmtToPar(outToPar) : ""
        document.querySelector("#in-to-par").innerText = inTotal>0? fmtToPar(inToPar) : ""
        document.querySelector("#total-to-par").innerText = outTotal>0 && inTotal>0? fmtToPar(toPar) : ""
    }

    // set up button click handlers
    document.querySelector("#plus").addEventListener("click", () => updateScore(loadedHoleNumber, +1))
    document.querySelector("#minus").addEventListener("click", () => updateScore(loadedHoleNumber, -1))
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
    const mapBounds = theMap.getBounds()
    const loc = locationMarker.getLatLng()
    const useLocationMarker = mapBounds.contains(loc) || mapBounds.getCenter().distanceTo(loc) < 1000
    const useMarkers = pathMarkers.filter(m => m != locationMarker || useLocationMarker)
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
        // TODO: setting to move tips to right side for lefties
        m2.bindTooltip(tip, {
            permanent: true,
            direction: "bottom",
            offset: L.point([0, 15]),
            draggable: true,
            className: "distance-info"
        })
    }

    // make sure we're in front of course features
    try {
        pathLine.bringToFront()
    } catch (e) {
        // TODO: in tutorial mode this fails initially - why?
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
    
    // advance tutorial
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
        lastPos = await getPos()
        print("watching for position changes")
        navigator.geolocation.watchPosition(
            async (pos) => moveLocationMarker(pos, false),
            (e) => print("position watcher got error", e),
            {enableHighAccuracy: true, timeout: 5000}
        )
    } else {
        print("lastPos already set so not watching for position changes")
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

        // don't do markers unless a course is loaded
        // moving a marker at low zoom can cause enormouse number of elevation tile fetches
        if (!loadedCourseName) {
            print("no course loaded")
            return
        }

        // create marker
        const marker = L.marker(e.latlng, {
            icon: markerIcon,
            draggable: true,
            autoPan: false,
            autoPanOnFocus: false, // https://github.com/Raruto/leaflet-rotate/issues/28
        }).addTo(theMap)
        pathMarkers.push(marker)
        didAction("addMarker-" + pathMarkers.length)

        // redraw line and update distance info to include new marker
        updateLine()

        // clicking marker removes it
        marker.on("click", () => {
            marker.remove()
            pathMarkers = pathMarkers.filter(m => m !== marker)
            updateLine()
            didAction("removeMarker-" + pathMarkers.length)
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
           way[golf="driving_range"](around:${distance},${lat},${lon});
           way[name="${name}"]; // this picks up course boundaries
        );
    `
    const features = await query(featuresQuery)

    // check if a feature is actually on the course and is a feature type we're interested in
    const courseBounds = features.features.filter(f => f.properties.name == name)[0]
    function onCourse(feature) {
        if (feature.properties.leisure == "golf_course" || feature.properties.golf == "driving_range") {
            // don't want the course bounds in this feature list
            return false
        } if (["Polygon", "LineString"].includes(feature.geometry.type)) {
            // tee, bunker, fairway, green
            if (turf.booleanWithin(feature.geometry, courseBounds))
                return true
        } else {
            print("unknown feature geometry type", feature.geometry.type)
        }
        print("excluding", feature)
        return false
    }

    // check if a feature is on a driving range
    const drivingRanges = features.features.filter(feature => feature.properties.golf == "driving_range")
    const onDrivingRange = feature => drivingRanges.some(range => turf.booleanWithin(feature.geometry, range))

    // filter the features we found within a certain radius of the course
    // to include only those actually within the course bounds, and not on a driving range
    // do this here so it gets cached
    const courseFeatures = features.features.filter((feature) => onCourse(feature) && !onDrivingRange(feature))
    return courseFeatures
}

// take the initials of relevant words to display in the course icon on the map
function shorten(name) {
    var words = name.split(" ")
    words = words.filter(word => /^[A-Z]/.test(word))
    words = words.filter(word => !["Golf", "Course", "Club", "Country", "Center"].includes(word))
    const short_name = words.map(word => word.slice(0, 1)).join("")
    return short_name
}

// find golf courses within the given lat/lon bounds
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

var knownCourses = {}
var loadedCourseName = null
var loadedCourseHoleFeatures = []
var selectCourseMarkerLayer

// zoom is animated
// in some cases if we don't wait for the animation to finish
// subsequent steps don't behave as we expect
async function waitForZoom(zoom) {
    if (theMap.getZoom() != zoom) {
        print("awaiting zoomend for zoom", zoom, "now", theMap.getZoom())
        await new Promise((resolve, reject) => {theMap.on("zoomend", resolve)})
        print("zoomend")
    }
}

// load a course by name
// sets loadedCourseName and loadedCOurseHoleFeatures
async function loadCourse(name, setView=true) {

    // advance the tutorial
    didAction("loadCourse-" + shorten(name))

    // clean slate
    resetScorecard()
    resetPath()
    theMap.setBearing(0)

    // get course data
    const latlon = knownCourses[name]
    const courseFeatures = await cacheJSON(name, () => queryCourseFeatures(name, latlon))

    // group features by nearest hole into loadedCourseHoleFeatures array
    // loadedCourseHoleFeatures is indexed by hole number,
    // and each element is an array of features associated with that hole
    // first element of each array is the hole feature (line representing hole) itself

    // first get the hole feature (line representing hole)
    loadedCourseHoleFeatures = []
    for (const feature of courseFeatures) {
        if (feature.properties.golf == "hole") {
            // other code depends on the "hole" feature being first in the features array
            const holeNumber = feature.properties.ref
            loadedCourseHoleFeatures[holeNumber] = [feature]
        }
    }

    // then for each non-hole feature associate it with the closest hole
    for (const feature of courseFeatures) {
        if (feature.properties.golf != "hole") {
            const centroid = turf.centroid(feature)
            var minDistance = Infinity
            var minHoleNumber
            for (const holeNumber in loadedCourseHoleFeatures) {
                const holeFeature = loadedCourseHoleFeatures[holeNumber][0]
                const distance = turf.pointToLineDistance(centroid, holeFeature)
                if (distance < minDistance) {
                    minDistance = distance
                    minHoleNumber = holeNumber
                }
            }
            if (minHoleNumber)
                loadedCourseHoleFeatures[minHoleNumber].push(feature) 
        }
    }

    // show the course
    if (setView) {
        print("setview", latlon)
        theMap.setView(latlon, courseZoom)
        await waitForZoom(courseZoom)
    }

    // no longer in course select mode
    selectCourseMarkerLayer.remove()

    // remember it
    loadedCourseName = name
}

function unloadCourse() {
    loadedCourseName = null
    loadedCourseHoleFeatures = []
    unloadHole()
}

// put up markers to select courses centered around current location
async function selectCourse(userAction) {

    // update tutorial
    if (userAction)
        didAction("selectCourse")

    // clean slate
    if (selectCourseMarkerLayer)
        selectCourseMarkerLayer.remove()
    selectCourseMarkerLayer = L.layerGroup().addTo(theMap)
    unloadCourse()
    resetPath()
    theMap.setBearing(0)
    theMap.setZoom(selectCourseZoom)
    await waitForZoom(selectCourseZoom)

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
                    loadCourse(courseName)
                }).addTo(selectCourseMarkerLayer)
            }
        }
    }
}

// are we within 1000 m of a course centroid?
// TODO: use actual course bounds?
async function atCourse(pos, name, distance = 1000) {
    if (!name)
        return false
    const latlon = knownCourses[name]
    return turfDistance(pos, latlon) < distance
}

// if we're at a course load it
async function loadNearbyCourse() {
    const pos = await getPos()
    for (const name in knownCourses) {
        if (await atCourse(pos, name)) {
            await loadCourse(name)
            return
        }
    }
}

async function manageCourses()  {

    const selectCourseButton = document.querySelector("#select-course")
    selectCourseButton.addEventListener("click", () => selectCourse(true))

    // this is our initial action unless in tutorial mode which handles initial state
    if (!tutorialElt) {
        await selectCourse(false)
        await loadNearbyCourse()
    }
}


////////////////////////////////////////////////////////////
//
// entry point
//

async function main() {

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
              <div id="messages"></div>
              <div id="console"></div>
          </div>
          <div id="score-row">
              <table id="score-front" class="scorecard"><tr class="hole-number"><tr class="hole-score"></table>
              <table id="score-back" class="scorecard"><tr class="hole-number"><tr class="hole-score"></table>
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
    // this was supposed to exclude Android navigation bar, solving the problem with
    // css dvh, but it didn't seem to, so sticking with css
    //document.body.style.height = `${window.innerHeight}px`

    try {
        await manageMap()
        await manageSettings()
        await manageScorecard()
        await manageTutorial()
        await manageLocation()
        await manageCourses()
    } catch (e) {
        if (e.message)
            showMessage(e.message)
        throw e
    }
}

main()
