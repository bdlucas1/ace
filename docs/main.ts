// © 2025 Bruce D. Lucas https://github.com/bdlucas1
// SPDX-License-Identifier: AGPL-3.0

/// <reference path="tutorial.ts" />

////////////////////////////////////////////////////////////
//
// logging
//

function divLog(kind: string, ...args: any[]) {
    const consoleElt =  document.getElementById("console")
    if (consoleElt) {
        const elt = document.createElement("div")
        elt.classList.add("console-" + kind)
        elt.innerText = args.join(" ")
        consoleElt.appendChild(elt)
        elt.scrollIntoView()
    }
}

function intercept(console: any, kind: string) {
    const oldFun = console[kind]
    console[kind] = (...args: any[]) => {
        oldFun(...args)
        divLog(kind, ...args)
    }
    
}

for (const kind of ["log", "info", "error", "warning", "trace", "debug"])
    intercept(console, kind)

const log = console.log
const logj = (j: any) => log(JSON.stringify(j, null, 2))

window.onerror = e => divLog("error", e)
window.onunhandledrejection = e => divLog("error", e.reason.stack)


////////////////////////////////////////////////////////////
//
// geometry helpers
//

// e.g. GeolocationPosition.coords
type Pos = {
    latitude: number,
    longitude: number,
    accuracy: number,
}

// [lon,lat], in that order, as an array
type LL = [number, number]

const pos2ll = (pos: Pos): LL  => [pos.longitude, pos.latitude]

const empty = turf.featureCollection([])


////////////////////////////////////////////////////////////
//
// app state
//

function setAppState(key: string, value: any) {
    var appState = JSON.parse(localStorage.getItem("appState") || "{}")
    appState[key] = value
    localStorage.setItem("appState", JSON.stringify(appState))
    log(`AppState(${key},${value}); state is now`, JSON.stringify(appState))
}

function getAppState(key: string) {
    var appState = JSON.parse(localStorage.getItem("appState") || "{}")
    log(`getApppState(${key}); state is`, JSON.stringify(appState))
    return appState[key]
}

////////////////////////////////////////////////////////////
//
// get elevation
//

const elevationTileCache =  new Map()

async function getElevation(lon: number, lat: number) {

    const z = 16

    // compute fractional tile fx,fy and integer tile x,y
    const d2r = Math.PI / 180
    const sin = Math.sin(lat * d2r)
    const z2 = Math.pow(2, z)
    const fx = z2 * (lon / 360 + 0.5)
    const fy = z2 * (0.5 - 0.25 * Math.log((1 + sin) / (1 - sin)) / Math.PI)

    const xyz2url = (x: number, y: number, z: number) =>
        "https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D" +
        `/ImageServer/tile/${z}/${y}/${x}`

    // load decoder
    await Lerc.load()

    // get tile data
    const [x, y] = [Math.floor(fx), Math.floor(fy)]
    const key = x + "," + y + "," + z
    if (!elevationTileCache.has(key)) {
        log("fetching elevation tile", key)
        const url = xyz2url(x, y, z)
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


////////////////////////////////////////////////////////////
//
// our map
//

import ml = maplibregl // give it a shorter name

function divMarker(className: string, anchor: ml.PositionAnchor = "center") {
    const element = document.createElement("div")
    return new ml.Marker({element, anchor, className})
}

class GolfMap extends ml.Map {

    static the: GolfMap

    static holeZoom = 16
    static courseZoom = 14
    static selectCourseZoom = 10
    static maxZoom = 19

    basemaps: {[_: string]: ml.SourceSpecification} = {
        streetmap: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            maxzoom: 19, // seems to be max available
            attribution: "<a href='https://openstreetmap.org'>©OpenStreetMap</a>"
        },
        aerial: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 19, // max good - 20 is less appealing
            attribution: "<a href='https://esri.com'>©Esri</a>"
        }
    }

    currentBasemap = 0

    constructor() {

        addHTML(`
            <div class="main-button basemap-button" id="basemap"></div>
            <div id='map'></div>
        `)

        super({
            container: 'map',
            zoom: GolfMap.selectCourseZoom,
            maxZoom: GolfMap.maxZoom
        })            

        for (const [name, defn] of Object.entries(this.basemaps))
            this.addSource(name, defn)

        // advance tutorial
        this.on("zoomstart", () => Tutorial.the.didAction("zoom"))
        this.on("dragstart", () => Tutorial.the.didAction("pan"))

        // our own layer switcher
        this.switchToBasemap(0) // initial
        document.getElementById("basemap")!.addEventListener("click", () => {
            this.switchToBasemap((this.currentBasemap + 1) % Object.keys(this.basemaps).length)
            Tutorial.the.didAction("basemap")
        })

        // singleton
        GolfMap.the = this
    }

    async init() {
        await new Promise((resolve, reject) => this.on("load", resolve))
        this.resize()
    }

    switchToBasemap(i: number) {
        if (this.getLayer("basemap"))
            this.removeLayer("basemap")
        const firstLayerId = this.getStyle().layers?.[0]?.id; // ugh - no simpler way to place below all layers?
        this.addLayer({
            id: "basemap",
            type: "raster",
            source: Object.keys(this.basemaps)[i],
        }, firstLayerId)
        this.currentBasemap = i
    }
}
    

////////////////////////////////////////////////////////////
//
// scorecard, loaded hole
//

class ScoreCard {

    static the: ScoreCard

    loadedHoleNumber = 0
    golfHoleFeatures: ml.GeoJSONSource

    constructor() {

        ScoreCard.the = this

        // add our UI elements
        addHTML(`
          <div class="main-button minus-button" id="minus"></div>
          <div class="main-button plus-button" id="plus"></div>
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
        `)

        // create empty source and layer for golf hole features
        // will change data when we load a hole
        GolfMap.the.addSource('golfHoleFeatures', {
            type: 'geojson',
            data: empty
        })
        this.golfHoleFeatures = GolfMap.the.getSource<ml.GeoJSONSource>("golfHoleFeatures")!
        GolfMap.the.addLayer({
            id: 'golfHoleLayer',
            type: 'line',
            source: 'golfHoleFeatures',
            paint: {
                'line-color': [
                    'match',
                    ['get', 'golf'],
                    'green', getCSSValue("--golf-green"),
                    'bunker', getCSSValue("--golf-bunker"),
                    'fairway', getCSSValue("--golf-fairway"),
                    'tee', getCSSValue("--golf-tee"),
                    '#00000000' // default - invisible
                ],
                'line-width': 3
            }
        })

        // set up one scorecard column
        const addHoleColumn = (table: Element, holeNumber: number) => {

            // hole number cell
            var td = document.createElement("td")
            td.innerText = String(holeNumber)
            td.id = `hole-number-${holeNumber}`
            td.addEventListener("click", () => this.loadHole(holeNumber))
            table.querySelector<Element>(".hole-number")!.appendChild(td)
            
            // score cell
            td = document.createElement("td")
            td.id = `hole-score-${holeNumber}`
            td.addEventListener("click", () => this.loadHole(holeNumber))
            table.querySelector<Element>(".hole-score")!.appendChild(td)
        }
        var holeNumber = 1
        document.querySelectorAll(".scorecard").forEach(table => {
            for (var i = 0; i < 9; i++, holeNumber++)
                addHoleColumn(table, holeNumber)
        })

        // advance tutorial on scorecard scroll
        document.getElementById("score-row")!.addEventListener("scroll", (e) => {
            const elt = document.getElementById("score-row")!
            const right = elt.getBoundingClientRect().right
            var lastVisibleId
            for (const e of elt.children) {
                const rect = e.getBoundingClientRect();
                if (rect.left + rect.width/2 < right)
                    lastVisibleId = e.id
            }
            Tutorial.the.didAction("scrollTo-" + lastVisibleId)
        })

        // add or subtract one from score
        function updateScore(holeNumber: number, update: number) {

            // advance tutorial
            Tutorial.the.didAction(update > 0? "increaseScore" : "decreaseScore")

            // update hole score
            const td = document.getElementById(`hole-score-${holeNumber}`)!
            const newScore = Number(td.innerText) + update
            td.innerText = newScore > 0? String(newScore) : " "


            // this assumes the "hole" feature is the first in the array of features for each hole
            // returns undefined if par is not available
            const parFor = (holeNumber: number) => {
                const holeInfo = Courses.the.loadedHoleInfo.get(holeNumber)
                return holeInfo?.hole.properties?.par
            }

            // update total score and total to par
            // toPar becomes NaN if par is unavailable for any hole,
            // which causes fmtPar to return blank
            function computeScore(start: number) {
                for (var holeNumber = start, total = 0, toPar = 0, i = 0; i < 9; i++, holeNumber++) {
                    const score = Number(document.getElementById(`hole-score-${holeNumber}`)!.innerText)
                    total += score
                    if (score > 0)
                        toPar += score - parFor(holeNumber)
                }
                return [total, toPar]
            }                
            const [outTotal, outToPar] = computeScore(1)
            const [inTotal, inToPar] = computeScore(10)

            const total = outTotal + inTotal
            const fmtToPar = (toPar: number) => toPar==0? "E": toPar>0? "+"+toPar : toPar<0? String(toPar) : ""
            const toPar = inToPar + outToPar

            document.getElementById("out-score")!.innerText = outTotal > 0? String(outTotal) : ""
            document.getElementById("in-score")!.innerText = inTotal > 0? String(inTotal) : ""
            document.getElementById("total-score")!.innerText = inTotal>0 && outTotal>0? String(total) : ""

            document.getElementById("out-to-par")!.innerText = outTotal>0? fmtToPar(outToPar) : ""
            document.getElementById("in-to-par")!.innerText = inTotal>0? fmtToPar(inToPar) : ""
            document.getElementById("total-to-par")!.innerText = outTotal>0 && inTotal>0? fmtToPar(toPar) : ""
        }

        // set up button click handlers for incr/decr hole score
        document.getElementById("plus")!.addEventListener("click", () => updateScore(this.loadedHoleNumber, +1))
        document.getElementById("minus")!.addEventListener("click", () => updateScore(this.loadedHoleNumber, -1))
    }

    async init() {
    }

    async loadHole(holeNumber: number) {

        log("loadHole", holeNumber)

        // update tutorial
        Tutorial.the.didAction("loadHole")
        Tutorial.the.didAction("loadHole-" + holeNumber)

        // TODO: too early?
        if (!Courses.the.loadedCourseName)
            return

        // switch hole hole
        this.unloadHole()
        this.loadedHoleNumber = holeNumber

        // style selected hole on scorecard
        document.getElementById(`hole-number-${this.loadedHoleNumber}`)!.classList.add("selected")
        document.getElementById(`hole-score-${this.loadedHoleNumber}`)!.classList.add("selected")

        // do we have hole info to show?
        const holeInfo = Courses.the.loadedHoleInfo.get(holeNumber)
        if (!holeInfo) {

            // no hole info - just zoom in on current location
            log("no features")
            const pos = await Path.the.getPos()
            if (Courses.the.atCourse(pos, Courses.the.loadedCourseName))
                GolfMap.the.jumpTo({center: pos2ll(pos), zoom: GolfMap.holeZoom})
            return

        } else {

            // we have hole info - zoom in on it

            // select and show hole features
            const data = turf.featureCollection(holeInfo.features)
            this.golfHoleFeatures.setData(data)

            // center hole on map, zoom in, and rotate bearing to align with hole
            // zoomAdjust pulls the zoom out a bit for breathing room around the edges;
            // allow more if in tutorial because of the tutorial message box
            // fitBounds doesn't do the zoom correctly for bearing not 0, so we compute zoom explicitly
            const coordinates = holeInfo?.hole.geometry.coordinates
            const bearing = coordinates? turf.bearing(coordinates[0], coordinates[coordinates.length - 1]) : 0
            const center = turf.center(data).geometry.coordinates as LL
            const rotated = turf.transformRotate(data, -bearing)
            const rotatedBbox = turf.bbox(rotated) as [number, number, number, number]
            const zoomAdjust = Tutorial.the.inProgress? 1 : 0.3
            const zoom = GolfMap.the.cameraForBounds(rotatedBbox)!.zoom! - zoomAdjust
            GolfMap.the.easeTo({zoom, center, bearing})
            Path.the.reset()
        }
    }

    unloadHole() {
        if (this.loadedHoleNumber) {
            document.getElementById(`hole-number-${this.loadedHoleNumber}`)!.classList.remove("selected")
            document.getElementById(`hole-score-${this.loadedHoleNumber}`)!.classList.remove("selected")
            this.loadedHoleNumber = 0
        }
        this.golfHoleFeatures.setData(empty)
    }

    reset() {
        const elt = document.querySelector<HTMLElement>("#score-row")!
        elt.querySelectorAll<HTMLElement>(`td`).forEach(e => e.classList.remove("selected"))
        elt.querySelectorAll<HTMLElement>(".total-score td").forEach(e => e.innerText = "")
        elt.querySelectorAll<HTMLElement>(".hole-score td").forEach(e => e.innerText = "")
        elt.scrollLeft = 0
        this.unloadHole()
    }

}


////////////////////////////////////////////////////////////
//
// Tutorial
//

class Tutorial {

    static the: Tutorial

    inProgress = false
    // TODO: allocate this in constructor so it isn't optional
    tutorialElt?: HTMLElement
    sawFinalMessage = false
    
    // TODO: more setup here, e.g. createtutorialelt
    constructor() {
        Tutorial.the = this
    }

    async init() {

        const url = new URL(document.baseURI)
        if (!getAppState("didTutorial") || url.searchParams.has("tutorial")) {
            // load tutorial
            // do this synchronously to ensure startTutorial is done before we proceed
            // TODO: can this just be fetch and eval?
            const tutorialScript = document.createElement("script")
            tutorialScript.src = "tutorial.js"
            const loaded = new Promise(resolve => tutorialScript.onload = resolve)
            document.head.appendChild(tutorialScript)
            await loaded

            // now start it
            this.startTutorial()
        }
    }

    async startTutorial() {

        this.inProgress = true

        this.tutorialElt = document.createElement("div")
        this.tutorialElt.classList.add("tutorial")
        document.getElementById("messages")!.appendChild(this.tutorialElt)

        // prevent clicks on tutorial from toggling settings
        this.tutorialElt.addEventListener("click", e => e.stopPropagation())

        // watch for step to become newly visible and run its setup, if any
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (!(entry.target instanceof HTMLElement))
                    return
                if (entry.isIntersecting && entry.target.dataset.tutorialSetup) {
                    log(entry.target.id, "became visible; running its setup")
                    const setup = eval(entry.target.dataset.tutorialSetup)
                    setup()
                }
            })
        })


        // generate a div for each step and add it to the tutorial div
        var stepNumber = 0
        for (const step of tutorialSteps) {
            const stepElt = document.createElement("div")
            stepElt.id = "tutorial-step-" + stepNumber++
            stepElt.classList.add("message")
            stepElt.innerHTML = `<div class='closer'></div>${step.text}`
            stepElt.querySelector(".closer")!.addEventListener("click", () => this.endTutorial());
            //stepElt.addEventListener("click", (e) => e.stopPropagation())
            if (step.setup)
                stepElt.dataset.tutorialSetup = String(step.setup)
            observer.observe(stepElt)
            this.tutorialElt.appendChild(stepElt)
            this.tutorialElt.dataset.onmessageclose = String(() => this.endTutorial())
        }

        // run setup for first step early which sets lastPos which disables position watcher
        // TODO: is there a better way to do this? this causes first tutorial step setup to be run twice.
        log("running setup for tutorial step 0 to set lastPos")
        tutorialSteps[0].setup?.()
    }

    async didAction(name: string) {
        //log("didAction", name)
        document.querySelectorAll(".action." + name).forEach(e => {
            e.classList.add("completed")
        })
    }

    clearActions(...actions: string[]) {
        for (const action of actions) {
            document.querySelectorAll(".action." + action).forEach(e => {
                e.classList.remove("completed")
            })
        }
    }

    async endTutorial() {
        setAppState("didTutorial", true)
        if (this.sawFinalMessage)
            window.location.href = "." + window.location.search
        else
            this.tutorialElt!.lastElementChild!.scrollIntoView({behavior: "instant"})
    }

}




////////////////////////////////////////////////////////////
//
// Path
// 

class Path {

    // singleton
    static the: Path

    locationMarker: ml.Marker
    accuracyCircle: ml.GeoJSONSource
    pathMarkers: ml.Marker[] = []
    pathLine: ml.GeoJSONSource
    lastPos? : Pos
    ignoreClickHack: number = 0
    
    constructor() {

        addHTML("<div class='main-button locate-button' id='locate'></div>")

        // current location
        this.locationMarker = divMarker("crosshair-marker").setLngLat([0,0]).addTo(GolfMap.the)

        // accuracy circle - empty now, will fill later
        GolfMap.the.addSource("accuracyCircle", {"type": "geojson", data: empty})
        this.accuracyCircle = GolfMap.the.getSource<ml.GeoJSONSource>("accuracyCircle")!        
        GolfMap.the.addLayer({
            id: "accuracyCircleLayer",
            type: "fill",
            source: "accuracyCircle",
            paint: {
                //"line-color": "#6084eb",
                //"line-width": 3,
                "fill-color": "#6084eb30",
            }

        })

        // path, initially empty
        GolfMap.the.addSource("pathLine", {type: "geojson", data: empty})
        this.pathLine = GolfMap.the.getSource<ml.GeoJSONSource>("pathLine")!
        GolfMap.the.addLayer({
            "id": "pathLineLayer",
            "type": "line",
            "source": "pathLine",
            "paint": {
                "line-color": getCSSValue("--path"),
                "line-width": 3,
            }
        });

        // singleton
        Path.the = this
    }

    async init() {
    
        // watch for position changes, or use fake position
        const url = new URL(document.baseURI)
        if (url.searchParams.has("testPos")) {
            const [lat, lon] = url.searchParams.get("testPos")!.split(",")
            this.fakeLocation([Number(lon), Number(lat)])
        }

        if (!this.lastPos) {
            // watch for position changes, and update locationMarker accordingly
            // this does not center the locationMarker
            this.lastPos = await this.getPos()
            log("watching for position changes")
            navigator.geolocation.watchPosition(
                async (pos) => this.moveLocationMarker(pos.coords),
                (e) => log("position watcher got error", e),
                {enableHighAccuracy: true, timeout: 5000}
            )
        } else {
            log("lastPos already set so not watching for position changes")
        }
        
        // locate button moves map to current location
        const locateButton = document.getElementById("locate")!
        locateButton.addEventListener("click", () => this.goToCurrentLocation(true))

        // clicking on map adds a marker
        GolfMap.the.on("click", e => {
            
            if (this.ignoreClickHack) {
                log("map click ignored")
                return
            }

            // don't do markers unless a course is loaded
            // moving a marker at low zoom can cause enormouse number of elevation tile fetches
            if (!Courses.the.loadedCourseName) {
                log("no course loaded")
                return
            }

            // create marker and associated info box
            const marker = divMarker("path-marker").setDraggable(true).setLngLat(e.lngLat).addTo(GolfMap.the)
            this.pathMarkers.push(marker)
            const popup = new ml.Popup({
                anchor: "top", offset: 20,
                closeOnClick: false, closeButton: false,
            })
            marker.setPopup(popup).togglePopup()
            Tutorial.the.didAction("addMarker-" + this.pathMarkers.length)
            
            // redraw line and update distance info to include new marker
            this.updateLine()

            // clicking marker removes it
            // TODO: get rid of divIcon, use generated element directly
            marker._element.addEventListener("click", (e) => {
                if (this.ignoreClickHack) {
                    log("marker click ignored")
                    return
                }
                marker.remove()
                this.pathMarkers = this.pathMarkers.filter(m => m != marker)
                this.updateLine()
                e.stopPropagation()
                Tutorial.the.didAction("removeMarker-" + this.pathMarkers.length)
            })

            // dragging marker updates line
            // sometimes on iPhone this generates a spurious click event after dragging ends
            // don't know why, or why iPhone-specific, but the ignoreClickHack fixes the problem
            // TODO: look into whether there's a better way
            var dragInProgress = false;
            marker.on("drag", async () => {
                if (dragInProgress)
                    return
                dragInProgress = true
                try {
                    await this.updateLine()
                } finally {
                    dragInProgress = false
                }
            })
            marker.on("dragend", () => {
                this.updateLine()
                Tutorial.the.didAction("moveMarker")
                this.ignoreClickHack = setTimeout(() => this.ignoreClickHack = 0, 500)
            })
        })

        await this.goToCurrentLocation()
    }

    async getPos(): Promise<Pos> {
        if (this.lastPos) {
            // use last reported by watchPosition
            return this.lastPos;
        } else {
            try {
                const pos: GeolocationPosition = await new Promise((resolve, reject) => {
                    const options = {enableHighAccuracy: true, timeout: 5000}
                    navigator.geolocation.getCurrentPosition(resolve, reject, options)
                })
                return pos.coords
            } catch(e: any) {
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
                log("e", e)
                showMessage(message)
                throw Error()
            }
        }
    }

    // draw a line connecting markers and update distance info
    // only use the location marker if it's visible in the current viewport
    async updateLine() {

        // update the polyline
        const mapBounds = GolfMap.the.getBounds()
        const loc = this.locationMarker.getLngLat()
        const useLocationMarker = mapBounds.contains(loc) || mapBounds.getCenter().distanceTo(loc) < 1000
        const useMarkers = this.pathMarkers.filter(m => m != this.locationMarker || useLocationMarker)
        const lls = useMarkers.map(m => m.getLngLat().toArray())
        this.pathLine.setData(lls.length > 1? turf.lineString(lls) : empty)
        
        // update the distance info
        useMarkers[0]?.getPopup()?.setHTML("")
        for (var i = 1; i < useMarkers.length; i++) {
            const [m1, m2] = [useMarkers[i-1], useMarkers[i]]
            const [ll1, ll2] = [m1.getLngLat().toArray(), m2.getLngLat().toArray()]
            const [p1, p2] = [turf.point(ll1), turf.point(ll2)]
            const [e1, e2] = [await getElevation(...ll1), await getElevation(...ll2)]
            const distanceYd = turf.distance(p1, p2, {units: "yards"})
            const elChangeFt = (e2 - e1) * 3.28084
            const playsLikeYd = distanceYd + elChangeFt / 3
            const tip = `
                ${Math.round(distanceYd)} yd <br/>
                ${elChangeFt >= 0? "+" + Math.round(elChangeFt) : Math.round(elChangeFt)} ft <br/>
                ${Math.round(playsLikeYd)} yd <br/>
            `
            m2.getPopup().setHTML(tip)
        }
    }

    reset() {
        for (const marker of this.pathMarkers)
            if (marker != this.locationMarker)
                marker.remove()
        this.pathMarkers = [this.locationMarker]
        this.updateLine()
    }

    // move the locationMarker, optionally centering it
    async moveLocationMarker(pos: Pos, center?: "ease" | "jump") {

        // update location and accuracy marker, and optionally center view if requested
        // also remember this position as lastPos, and update the path
        const ll = pos2ll(pos)
        this.locationMarker.setLngLat(ll)
        const circle = turf.circle(turf.point(ll), pos.accuracy, {units: "meters"})
        this.accuracyCircle.setData(circle)
        if (center == "ease")
            GolfMap.the.easeTo({center: pos2ll(pos)})
        else if (center == "jump")
            GolfMap.the.jumpTo({center: pos2ll(pos)})
        this.lastPos = pos
        this.updateLine()
    }

    // center the current location in the map and reset markers
    async goToCurrentLocation(userAction = false) {
    
        // advance tutorial
        if (userAction)
            Tutorial.the.didAction("goToCurrentLocation")

        // center on current position
        const pos = await this.getPos()
        this.moveLocationMarker(pos, userAction? "ease" : "jump")
        
        // remove other markers
        this.reset()
    }

    fakeLocation(ll: LL) {
        this.lastPos = {latitude: ll[1], longitude: ll[0], accuracy: 100}
        log("using fake location", this.lastPos)
    }

}




////////////////////////////////////////////////////////////
//
// settings page
//

class MsgElt extends Element {
    onmessageclose?: (elt: MsgElt) => void
}

function showMessage(html: string, timeMs=0): MsgElt {

    const msgElt = document.createElement("div")
    msgElt.classList.add("message")
    msgElt.addEventListener("click", (e) => e.stopPropagation())
    updateMessage(msgElt, html)

    const messagesElt = document.querySelector<Element>("#messages")!
    if (messagesElt)
        messagesElt.appendChild(msgElt)

    if (timeMs)
        setTimeout(() => removeMessage(msgElt), timeMs)

    return msgElt
}

function updateMessage(msgElt: MsgElt, html: string) {
    msgElt.innerHTML = `<div class='closer'></div>${html}`
    msgElt.querySelector<Element>(".closer")!.addEventListener("click", () => removeMessage(msgElt))
}

function removeMessage(msgElt: MsgElt) {
    const parent = msgElt.parentElement
    if (parent)
        parent.removeChild(msgElt)
    if (msgElt.onmessageclose)
        msgElt.onmessageclose(msgElt)
}

class Settings {

    static aboutPage = "https://github.com/bdlucas1/ace/blob/main/README.md"

    constructor() {

        /* settings screen and button to show settings screen */
        addHTML(`
            <div id="show-settings" class="main-button show-settings-button"></div>
            <div id="settings">
            <div id="messages"></div>
            <div id="console"></div>
            </div>
        `)

        // set up settings menu
        const settingsElt = document.querySelector<HTMLElement>("#settings")!
        const consoleElt = document.getElementById("console")!
        function addSetting(text: string, action: () => void) {
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
            window.location.href = Settings.aboutPage
        })
        
        // help button
        addSetting("Tutorial", () => {
            setAppState("didTutorial", false)
            window.location.href = "."
        })
        
        // clear course data button
        addSetting("Refresh course data", () => {
            log("clearing local storage")
            localStorage.clear()
        })
        
        // manage settings menu display
        var showing = false
        const toggleSettings = () => {
            showing = !showing
            if (showing) {
                settingsElt.style.visibility = "visible"
                settingsElt.style.zIndex = "200"
                // TODO: is there a less intrusive way of doing this?
                if (Tutorial.the.tutorialElt)
                    Tutorial.the.tutorialElt.style.pointerEvents = "none"
            } else {
                settingsElt.style.visibility = "hidden"
                settingsElt.style.zIndex = "unset"
                if (Tutorial.the.tutorialElt)
                    Tutorial.the.tutorialElt.style.pointerEvents = "auto"
            }
        }
        
        // set up show-settings button
        const settingsButton = document.getElementById("show-settings")!
        settingsButton.addEventListener("click", toggleSettings)
        settingsElt.addEventListener("click", toggleSettings)
        
        // for testing
        //showMessage("message 1", 3000)
        //showMessage("message 2", 5000)
    }

    async init() {
    }
}


////////////////////////////////////////////////////////////
//
// queries
//

// do an Overpass query against OSM data
// result per spec is always a FeatureList, so we just return Feature[]
async function query(query: string): Promise<GeoJSON.Feature[]> {

    const fullQuery = `
        [out:json][timeout:25];
           ${query}
        out body;
        >;
        out skel qt;
    `
    const api = "https://overpass-api.de/api/interpreter"
    const response = await fetch(api, {method: "POST", body: fullQuery,})
    if (!response.ok) {
        log("error", response)
        log(await response.text())
        throw "query error"
    }
    const responseJSON = await response.json()
    const geojson = osmtogeojson(responseJSON)
    return geojson.features
}

async function cacheJSON<T>(key: string, fun: () => Promise<T>, noCache=false) {
    const value: string | null = localStorage.getItem(key)
    if (value && !noCache) {
        log("using cached data for", key)
        return JSON.parse(value) as T
    } else {
        log("querying for", key)
        const msgElt = showMessage("Hang on, fetching course data...")
        const newValue = await fun()
        localStorage.setItem(key, JSON.stringify(newValue));
        removeMessage(msgElt)
        return newValue
    }
}


////////////////////////////////////////////////////////////
//
// queries
//

type HoleInfo = {
    hole: GeoJSON.Feature<GeoJSON.LineString>
    features: GeoJSON.Feature[]
}

type KnownCourse = {
    name: string
    ll: LL
}

class Courses {

    static the: Courses

    knownCourses: {[id: string]: KnownCourse} = {}
    courseMarkers: ml.Marker[] = []
    loadedCourseName: string | null = null
    loadedHoleInfo: Map<number, HoleInfo> = new Map()
    
    constructor() {
        addHTML("<div class='main-button select-course-button' id='select-course'></div>")
        const selectCourseButton = document.getElementById("select-course")!
        selectCourseButton.addEventListener("click", () => this.selectCourse(true))
        Courses.the = this
    }

    async init() {

        // this is our initial action unless in tutorial mode which handles initial state
        if (!Tutorial.the.inProgress) {
            await this.selectCourse(false)
            await this.loadNearbyCourse() 
        }
    }

    async queryCourseFeatures(id: string) {

        const [lon, lat] = this.knownCourses[id].ll

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
        const featuresQuery = `(
            way[golf="hole"](around:${distance},${lat},${lon});
            way[golf="tee"](around:${distance},${lat},${lon});
            nwr[golf="fairway"](around:${distance},${lat},${lon});
            way[golf="bunker"](around:${distance},${lat},${lon});
            way[golf="green"](around:${distance},${lat},${lon});
            way[golf="driving_range"](around:${distance},${lat},${lon});
            nwr(${id.split("/")[1]}); // this picks up course boundaries; nwr gets multi-polygons
        );`
        const features = await query(featuresQuery)

        // check if a feature is actually on the course and is a feature type we're interested in
        const courseBounds = features.filter((f: GeoJSON.Feature) => f.id == id)[0]
        function onCourse(f: GeoJSON.Feature) {
            if (f?.properties?.leisure == "golf_course" || f?.properties?.golf == "driving_range") {
                // don't want the course bounds in this feature list
                return false
            } if (["Polygon", "LineString"].includes(f.geometry.type)) {
                // tee, bunker, fairway, green
                if (turf.booleanWithin(f.geometry, courseBounds))
                    return true
            } else {
                log("unknown f geometry type", f.geometry.type)
            }
            log("excluding", f)
            return false
        }

        // check if a feature is on a driving range
        const drivingRanges = features.filter((f: GeoJSON.Feature) => f?.properties?.golf == "driving_range")
        const onDrivingRange = (f: GeoJSON.Feature) =>
            drivingRanges.some((range: GeoJSON.Feature) => turf.booleanWithin(f.geometry, range))
        // filter the features we found within a certain radius of the course
        // to include only those actually within the course bounds, and not on a driving range
        // do this here so it gets cached
        const courseFeatures = features.filter((f: GeoJSON.Feature) => onCourse(f) && !onDrivingRange(f))
        return courseFeatures
    }

    // take the initials of relevant words to display in the course icon on the map
    shorten(name: string) {
        var words = name.split(" ")
        words = words.filter(word => /^[A-Z0-9]/.test(word))
        const ignore = ["Golf", "Course", "Club", "Country", "Center", "Links", "The"]
        words = words.filter(word => !ignore.includes(word))
        const short_name = words.map(word => /^[0-9]/.test(word)? word : word.slice(0, 1)).join("")
        return short_name
    }

    // find golf courses within the given lat/lon bounds
    async queryCourses(south: number, west: number, north: number, east: number) {
        const q = `nwr[leisure=golf_course](${south},${west},${north},${east});`
        const courses = await query(q)
        const result: {[id: string]: KnownCourse} = {}
        for (const course of courses) {
            const center = turf.centroid(course)
            const [lon, lat] = center.geometry.coordinates
            const id = course.id!
            const name = course.properties?.name || ""
            log(`${id} / ${name || "UNNAMED"} / ${lon.toFixed(4)},${lat.toFixed(4)}`)
            result[id] = {name, ll: [lon, lat]}
        }
        return result
    }

    // load a course by name
    // sets loadedCourseName and loadedCOurseHoleFeatures
    async loadCourse(id: string, setView=true) {

        // advance the tutorial
        const name = this.knownCourses[id].name
        Tutorial.the.didAction("loadCourse-" + this.shorten(name))

        // already loaded?
        if (this.loadedCourseName == name)
            return

        // clean slate
        ScoreCard.the.reset()
        Path.the.reset()
        GolfMap.the.setBearing(0)

        // get course data
        const ll = this.knownCourses[id].ll
        const queryCourse = async () => await this.queryCourseFeatures(id)
        const courseFeatures = await cacheJSON<GeoJSON.Feature[]>(name, queryCourse)

        // group features by nearest hole into loadedHoleInfo
        // which is a Map from hole number to HoleInfo

        // first get the hole feature which is a line representing the hole
        // and add an entry to loadedHoleInfo for that hole
        for (const feature of courseFeatures) {
            if (feature.properties?.golf == "hole") {
                const holeNumber = Number(feature.properties?.ref)
                if (holeNumber) {
                    const holeInfo = {
                        // TODO: sanity check on feature?
                        hole: feature as GeoJSON.Feature<GeoJSON.LineString>,
                        features: []
                    }
                    this.loadedHoleInfo.set(holeNumber, holeInfo)
                }
            }
        }
            
        // then for each non-hole feature associate it with the closest hole
        // by adding it to the holeInfo.features array    
        for (const feature of courseFeatures) {
            if (feature.properties?.golf != "hole") {
                const centroid = turf.centroid(feature)
                var minDistance = 0.100 // only include features within 100m of hole line
                var closestHoleInfo: HoleInfo | undefined = undefined
                for (const holeInfo of this.loadedHoleInfo.values()) {
                    const distance = turf.pointToLineDistance(centroid, holeInfo.hole)
                    if (distance < minDistance) {
                        minDistance = distance
                        closestHoleInfo = holeInfo
                    }
                }
                if (closestHoleInfo)
                    closestHoleInfo.features.push(feature) 
            }
        }

        // show the course
        if (setView) {
            log("going to course", name, ll)
            GolfMap.the.easeTo({center: ll, zoom: GolfMap.courseZoom})
        }

        // no longer in course select mode
        for (const marker of this.courseMarkers)
            marker.remove()

        // remember it
        this.loadedCourseName = name
    }

    unloadCourse() {
        this.loadedCourseName = null
        this.loadedHoleInfo = new Map()
        ScoreCard.the.unloadHole()
    }

    // put up markers to select courses centered around current location
    async selectCourse(userAction: boolean) {

        // update tutorial
        if (userAction)
            Tutorial.the.didAction("selectCourse")

        // clean slate
        this.unloadCourse()
        Path.the.reset()
        GolfMap.the.setBearing(0)
        // TODO: zoomTo would be better, but conflicts with below
        // seem to get flickering if we add markers while animationg
        GolfMap.the.setZoom(GolfMap.selectCourseZoom)

        // snap to tile boundaries
        const tileSize = 0.25 // needs to be power of 2
        const dn = (x: number) => Math.floor(x/tileSize)*tileSize
        const up = (x: number) => Math.floor((x+tileSize)/tileSize)*tileSize

        // compute bounding box snapped to tiles of size tileSize deg
        const bounds = GolfMap.the.getBounds()
        const south = dn(bounds.getSouth())
        const west = dn(bounds.getWest())
        const north = up(bounds.getNorth())
        const east = up(bounds.getEast())

        // iterate over tiles adding markers
        const pos = await Path.the.getPos()
        for (var s = south; s < north; s += tileSize) {
            for (var w = west; w < east; w += tileSize) {
                const n = s + tileSize
                const e = w + tileSize
                const key = s + "," + w + "," + n + "," + e
                const courses = await cacheJSON(key, () => this.queryCourses(s, w, n, e))
                for (const [id, {name, ll}] of Object.entries(courses)) {
                    this.knownCourses[id] = {name, ll}
                    const element = document.createElement("div")
                    var shortName = this.shorten(name)
                    if (shortName.length > 2)
                        shortName = shortName.slice(0, 2) + "<br/>" + shortName.slice(2)
                    element.innerHTML = `<div>${shortName}</div>`
                    element.addEventListener("click", (e) => {
                        this.loadCourse(id)
                        e.stopPropagation()
                    })
                    const marker = new ml.Marker({element, anchor: "center", className: "course-icon"})
                    marker.setLngLat(ll).addTo(GolfMap.the)
                    this.courseMarkers.push(marker)
                }
            }
        }
    }

    // are we within 1000 m of a course centroid?
    // TODO: use actual course bounds?
    atCourse(pos: Pos, id: string, distance = 1000) {
        const ll = this.knownCourses[id]!.ll
        return turf.distance(pos2ll(pos), ll, {units: "meters"}) < distance
    }

    // if we're at a course load it
    async loadNearbyCourse() {
        const pos = await Path.the.getPos()
        for (const id in this.knownCourses) {
            if (this.atCourse(pos, id)) {
                await this.loadCourse(id)
                return
            }
        }
    }
}

////////////////////////////////////////////////////////////
//
// entry point
//

function getCSSValue(name: string) {
    return getComputedStyle(document.documentElement).getPropertyValue(name)
}

function addHTML(html: string) {
    document.getElementById("layout")!.insertAdjacentHTML("beforeend", html)
}

async function main() {

    // clear local storage if version has changed
    const appStateVersion = 4
    if (getAppState("version") != appStateVersion) {
        log("version changed; clearing local storage")
        localStorage.clear()
        setAppState("version", appStateVersion)
    }

    // TODO: revisit and document the z-index, visibility, and pointer-events strategy
    // for settings, messages, tutorial, map
    document.body.innerHTML = "<div id='layout'></div>"

    try {

        // construct components and the init them
        const classes = [GolfMap, Settings, ScoreCard, Tutorial, Path, Courses]
        const objects = classes.map(cls => new cls())
        for (const obj of objects)
            await obj.init()

    } catch (e: any) {
        if (e.message)
            showMessage(e.message)
        throw e
    }
}

main()
