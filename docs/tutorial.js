"use strict";
// © 2025 Bruce D. Lucas https://github.com/bdlucas1
// SPDX-License-Identifier: AGPL-3.0
/// <reference path="main.ts" />
const btn = (name) => `<span class='main-button tutorial-icon ${name}'></span>`;
const hand = "<span style='font-size: 120%'>👈</span>";
const link = (url, text) => `<a href='${url}' target='_blank' onclick='event.stopPropagation()'>${text}</a>`;
const action = (action) => `<span class='action ${action}'></span>`;
var tutorialSteps = [{
        setup: async () => {
            // TODO: is there already a function that does this?
            // TODO: want to start with course selection screen, but course is loaded I think by later setup
            const pos = { latitude: 41.31925403108735, longitude: -73.89320076036483, accuracy: 0 };
            await Path.the.moveLocationMarker(pos, "jump");
            await Courses.the.selectCourse(false);
        },
        text: `
        <p>This tutorial has a series of steps.
        Each step has actions you can perform to illustrate app features.
        As you complete each action it will be marked with a checkmark.
        Scroll this box left or right to move between steps.
        Close this box to end the tutorial.<p>

        <p>${action('nextStep')} Scroll left to go to the next step.</p>
`
    }, {
        setup: async () => {
            Tutorial.the.didAction("nextStep");
            const pos = { latitude: 41.31925403108735, longitude: -73.89320076036483, accuracy: 0 };
            await Path.the.moveLocationMarker(pos);
            await Courses.the.loadNearbyCourse();
        },
        text: `
        <p>In this scenario the app has detected that you are at your course.
        The ${btn('crosshair-icon')} marker shows your current location.</p>

        <p>${action('loadHole-1')} Tap hole 1 on the scorecard to zoom in</p>

        <p>When ready scroll left to go to the next step.</p>
    `,
    }, {
        setup: async () => {
            Tutorial.the.clearActions("zoom", "pan");
            const pos = { latitude: 41.31925403108735, longitude: -73.89320076036483, accuracy: 0 };
            await Path.the.moveLocationMarker(pos);
            await Courses.the.loadCourse("Hollow Brook Golf Club", false);
            await ScoreCard.the.loadHole(1);
        },
        text: `
        <p>You can drag the map to pan, or pinch to zoom in and out.
        (On desktop or laptop use scroll wheel if available.)</p>

        <p>${action('zoom')} Pinch to zoom</p>

        <p>${action('pan')} Drag to pan</p>
    `
    }, {
        text: `
        <p>You can tap on the map to place markers. Multiple markers form a path.
        The info box shows actual distance, elevation change, and plays-like distance.<p>

        <p>${action('addMarker-2')} Tap on the fairway to place a marker.</p>

        <p>${action('addMarker-3')} Tap on the green to place another marker.</p>
    `,
    }, {
        text: `
        <p>You can move markers and delete them to edit the path.</p>

        <p>${action('moveMarker')} Drag a marker to move it.</p>

        <p>${action('removeMarker-2')} Tap a marker to remove it.</p>
    `,
    }, {
        text: `
        <p>You can update your score using the ${btn('plus-button')} and ${btn('minus-button')} buttons.</p>

        <p>${action('increaseScore')} Tap ${btn("plus-button")} to increase your score</p>

        <p>${action('decreaseScore')} Tap ${btn('minus-button')} to decrease your score.</p>
    `,
    }, {
        text: `
        <p>The scorecard has three sections: front nine, back nine, and total.
        The total section shows both total score and score in relation to par.</p>

        <p>Scroll the scorecard left and right to switch between sections.</p>

        <p>${action('scrollTo-score-back')} Scroll scorecard left to see the back nine.</p>

        <p>${action('scrollTo-score-total')} Scroll left again to see the total.</p>
    `,
    }, {
        text: `
        <p>You can select a different course to look at from the map.</p>

        <p>${action('selectCourse')} Tap ${btn('select-course-button')} to go to the course selection screen.</p>

        <p>${action('loadCourse-M')} Then tap the <span class='course-icon tutorial-icon'><span>M</span></span>
        course marker on the map to the southeast of your current location.</p>
    `,
    }, {
        setup: async () => {
            await Courses.the.loadCourse("Mohansic Golf Course");
            GolfMap.the.switchToBasemap(0);
        },
        text: `
        <p>This course is shown on OpenStreetMap but it has  none of the course features.
        Check the ${link(Settings.aboutPage, 'About')} page to get involved in improving the maps.</p>

        <p>However you can still use the app for this course with the aerial view.</p>

        <p>${action('basemap')} Tap ${btn('basemap-button')} to switch to the aerial view.</p>
    `,
    }, {
        setup: async () => {
            Tutorial.the.clearActions("loadHole", "addMarker-2");
            const pos = { latitude: 41.27190532741085, longitude: -73.81042076933386, accuracy: 0 };
            await GolfMap.the.setBearing(0),
                await Path.the.moveLocationMarker(pos, "ease");
            await Courses.the.loadNearbyCourse();
            GolfMap.the.switchToBasemap(1);
        },
        text: `
        <p>Now we're at the first tee.
        You can tap on the scorecard to select a hole and zoom into your current location,
        and tap on the map to place markers and get distance and elevation data.</p>

        <p>${action('loadHole')} Tap the scorecard to zoom in.</p>

        <p>${action('addMarker-2')} Tap the map to add a marker.</p>
    `
    }, {
        setup: () => Tutorial.the.sawFinalMessage = true,
        text: `
        <p>For more information and tips see the ${link(Settings.aboutPage, 'About')} page.</p>

        <p>You can rerun the tutorial from the ${btn('show-settings-button')} menu.</p>

        <p>${action('')} Close this box to leave the tutorial.</p>
    `
    }];
//# sourceMappingURL=tutorial.js.map