// -----------------------------
// ZAKŁADAM: Cesium jest już załadowany i masz elementy DOM:
// - div#cesiumContainer
// - div#uiLabel z elementami #labelHeader, #labelList, #labelText, #closeBtn
// - obrazki "star.png" i "arrow.png" dostępne
// -----------------------------

const Z_INDEX = {
    ARROW_NORMAL: 10,
    BOX: 20,
    ARROW_ACTIVE: 30
};


function loadMarathonsFromURL(url, callback) {
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Nie udało się wczytać pliku");
            return response.text();
        })
        .then(text => {
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
            const marathonMap = new Map();

            lines.forEach(line => {
                const parts = line.split("|").map(p => p.trim());
                if (parts.length < 7) return;

                const [id, country, city, lonStr, latStr, type, date] = parts;
                const lon = parseFloat(lonStr);
                const lat = parseFloat(latStr);

                if (!marathonMap.has(id)) {
                    marathonMap.set(id, {
                        id: id,
                        country: country,
                        city: city,
                        lon: lon,
                        lat: lat,
                        marathons: []
                    });
                }

                marathonMap.get(id).marathons.push({ type: type, date: date });
            });

            const marathonPointsGrouped = Array.from(marathonMap.values());
            callback(marathonPointsGrouped);
        })
        .catch(err => console.error("Błąd wczytywania maratonów:", err));
}

// Detect mobile devices for further optimizations
const isMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|webOS/i.test(navigator.userAgent);
const isSmallScreen = window.innerWidth < 1024;
const isVerySmallScreen = window.innerWidth < 480;
const screenWidth = window.innerWidth;

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    imageryProvider: new Cesium.OpenStreetMapImageryProvider({
        url: "https://a.tile.openstreetmap.org/"
    }),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    navigationHelpButton: false,
    animation: false,
    creditsDisplay: false,
    selectionIndicator: false,
    infoBox: false,
});

// Performance adjustments
if (isMobile || isSmallScreen) {
    viewer.resolutionScale = 1.0;
    viewer.scene.globe.maximumScreenSpaceError = 8;
    if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = false;
    }
}
if (isVerySmallScreen) {
    viewer.resolutionScale = 0.8;
    viewer.scene.globe.maximumScreenSpaceError = 16;
}

const handler = viewer.cesiumWidget.screenSpaceEventHandler;
handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_MOVE);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_END);
viewer.scene.screenSpaceCameraController.enableTilt = false;

let previousPinchDistance = null;
handler.setInputAction(function (twoPoints) {
    const dx = twoPoints.position2.x - twoPoints.position1.x;
    const dy = twoPoints.position2.y - twoPoints.position1.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (previousPinchDistance !== null) {
        const delta = distance - previousPinchDistance;
        viewer.camera.moveForward(-delta * 0.5);
    }

    previousPinchDistance = distance;
}, Cesium.ScreenSpaceEventHandler.TwoPointMotionEvent);
handler.setInputAction(function () {
    previousPinchDistance = null;
}, Cesium.ScreenSpaceEventHandler.TwoPointEndEvent);

viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({
        url: 'https://a.tile.openstreetmap.org/',
        minimumLevel: 0,
        maximumLevel: 10
    })
);

const scene = viewer.scene;
scene.skyBox.show = false;
scene.skyAtmosphere.show = false;
scene.sun.show = false;
scene.moon.show = false;

const ellipsoid = Cesium.Ellipsoid.WGS84;
const occluder = new Cesium.EllipsoidalOccluder(ellipsoid, viewer.camera.positionWC);

// Helper: convert a world Cartesian to canvas coordinates relative to the Cesium container
function worldToContainerCoords(cartesian) {
    // scene.cartesianToCanvasCoordinates returns coordinates relative to scene.canvas client area
    const canvasPos = scene.cartesianToCanvasCoordinates(cartesian);
    if (!canvasPos) return null;

    // Get canvas bounding rect relative to container—because arrowDivs are appended to viewer.container
    const containerRect = viewer.container.getBoundingClientRect();
    const canvasRect = scene.canvas.getBoundingClientRect();
    const offsetLeft = canvasRect.left - containerRect.left;
    const offsetTop = canvasRect.top - containerRect.top;

    return {
        x: canvasPos.x + offsetLeft,
        y: canvasPos.y + offsetTop,
        canvasX: canvasPos.x, // relative to canvas (useful for center calculations)
        canvasY: canvasPos.y
    };
}

// Bearing and edge helpers (used if point is behind globe or offscreen)
function getBearingFromCameraToPoint(cartesian) {
    const direction = Cesium.Cartesian3.subtract(cartesian, viewer.camera.positionWC, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(direction, direction);
    const cameraDirection = new Cesium.Cartesian3();
    Cesium.Matrix4.multiplyByPointAsVector(viewer.camera.viewMatrix, direction, cameraDirection);
    return Math.atan2(cameraDirection.y, cameraDirection.x);
}

function getScreenEdgePosition(bearing, canvasSize) {
    const centerX = canvasSize.width / 2;
    const centerY = canvasSize.height / 2;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (canvasSize.width - centerX) / dx);
    if (dx < 0) t = Math.min(t, (0 - centerX) / dx);
    if (dy > 0) t = Math.min(t, (canvasSize.height - centerY) / dy);
    if (dy < 0) t = Math.min(t, (0 - centerY) / dy);
    const screenX = centerX + t * dx;
    const screenY = centerY + t * dy;
    return { x: screenX, y: screenY };
}

// Initial view
viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(55.2708, 25.2048, isSmallScreen ? 4000000 : 9000000) });
scene.screenSpaceCameraController.minimumZoomDistance = 1000000;
scene.screenSpaceCameraController.maximumZoomDistance = 8571000 * 2;

const label = document.getElementById('uiLabel');
label.style.position = 'absolute';
label.style.zIndex = Z_INDEX.BOX;
const labelText = document.getElementById('labelText');
const closeBtn = document.getElementById('closeBtn');
let activeEntity = null;

function hideOverlay() {
    activeEntity = null;
    label.style.display = 'none';
    updateArrowPriority(null);
}
closeBtn.addEventListener('click', hideOverlay);

// IMPORTANT CSS: ensure #cesiumContainer has position:relative and overflow:hidden
// e.g. in your CSS:
// #cesiumContainer { position: relative; overflow: hidden; }

// Load marathons and create points/arrows
loadMarathonsFromURL("marathons.txt", function (marathonPoints) {
    // arrow size base (will be adjusted in adjustForDevice)
    let arrowSizeNum = isSmallScreen ? Math.max(32, Math.round(screenWidth / 6)) : 40;

    const points = marathonPoints.map(p => {
        const entity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1),
            billboard: {
                image: "star.png",
                width: 40,
                height: 40,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        entity.data = p;
        entity.clickState = 0;

        // Create arrow div appended to viewer.container (absolute positioning)
        entity.arrowDiv = document.createElement('div');
        entity.arrowDiv.className = 'arrowIndicator';
        entity.arrowDiv.style.position = 'absolute';
        entity.arrowDiv.style.zIndex = Z_INDEX.ARROW_NORMAL;
        entity.arrowDiv.style.opacity = '1';
        entity.arrowDiv.style.width = arrowSizeNum + 'px';
        entity.arrowDiv.style.height = arrowSizeNum + 'px';
        entity.arrowDiv.style.padding = '6px';
        entity.arrowDiv.style.pointerEvents = 'auto';
        entity.arrowDiv.style.display = 'none';
        entity.arrowDiv.style.transformOrigin = '50% 50%';
        entity.arrowDiv.style.userSelect = 'none';
        entity.arrowDiv.innerHTML = '<img src="arrow.png" style="width:100%; height:100%; object-fit:contain; display:block;">';
        // store reference to entity
        entity.arrowDiv.entity = entity;

        // Click arrow: set activeEntity and flyTo - don't auto-hide label
        entity.arrowDiv.addEventListener('click', function (evt) {
            evt.stopPropagation();
            const ent = this.entity;
            // set active to this entity so overlay will attach to arrow if star not visible
            activeEntity = ent;
            updateArrowPriority(activeEntity);
            // also fly to the star (but don't hide overlay)
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(ent.data.lon, ent.data.lat, scene.screenSpaceCameraController.minimumZoomDistance),
                duration: 1.2
            });
        });

        // Append to viewer container (not document.body)
        viewer.container.appendChild(entity.arrowDiv);

        return entity;
    });

    function updateArrowPriority(activeEntity) {
        points.forEach(p => {
            if (p === activeEntity) {
                p.arrowDiv.style.zIndex = Z_INDEX.ARROW_ACTIVE;
                p.arrowDiv.style.opacity = '0.45';   // 👈 pół-przezroczysta
                p.arrowDiv.style.pointerEvents = 'auto';
            } else {
                p.arrowDiv.style.zIndex = Z_INDEX.ARROW_NORMAL;
                p.arrowDiv.style.opacity = '1';
                p.arrowDiv.style.pointerEvents = 'auto';
            }
        });
    }

    // Click on globe/star
    const clickHandler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    clickHandler.setInputAction(function (click) {
        const picked = scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id) {
            const entity = picked.id;
            // Toggle or set active
            if (entity.clickState === 0) {
                entity.clickState = 1;
                activeEntity = entity;
                updateArrowPriority(activeEntity);
                points.forEach(p => { if (p !== entity) p.clickState = 0; });
            } else {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                        entity.data.lon,
                        entity.data.lat,
                        scene.screenSpaceCameraController.minimumZoomDistance
                    ),
                    duration: 1.2
                });
                entity.clickState = 0;
                activeEntity = entity;
                updateArrowPriority(activeEntity);
            }
        } else {
            hideOverlay();
            points.forEach(p => p.clickState = 0);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Pre-render loop: update visibility, arrow positions, and label positioning
    scene.preRender.addEventListener(() => {
        // compute canvas and container sizes/offsets
        const containerRect = viewer.container.getBoundingClientRect();
        const canvasRect = scene.canvas.getBoundingClientRect();
        const canvasWidth = canvasRect.width;
        const canvasHeight = canvasRect.height;
        const canvasOffsetLeft = canvasRect.left - containerRect.left;
        const canvasOffsetTop = canvasRect.top - containerRect.top;

        // update occluder camera position
        occluder.cameraPosition = viewer.camera.positionWC;

        // Update each entity
        points.forEach(entity => {
            const pos = entity.position.getValue(Cesium.JulianDate.now());
            const visible = occluder.isPointVisible(pos);
            entity.billboard.show = visible;

            // try to get canvas coords (relative to canvas)
            const canvasCoords = scene.cartesianToCanvasCoordinates(pos);
            // convert to container coords if we have canvas coords
            const containerCoords = canvasCoords ? { x: canvasCoords.x + canvasOffsetLeft, y: canvasCoords.y + canvasOffsetTop } : null;

            // Decide if arrow must be shown:
            let arrowShouldShow = false;
            if (!visible) {
                // behind globe => show arrow
                arrowShouldShow = true;
            } else if (!canvasCoords) {
                // no canvas coords (odd), fall back to showing arrow
                arrowShouldShow = true;
            } else {
                // visible but possibly off-canvas (outside canvas bounds)
                if (canvasCoords.x < 0 || canvasCoords.x > canvasWidth || canvasCoords.y < 0 || canvasCoords.y > canvasHeight) {
                    arrowShouldShow = true;
                } else {
                    arrowShouldShow = false;
                }
            }

            if (!arrowShouldShow) {
                entity.arrowDiv.style.display = 'none';
            } else {
                // compute final arrow position (relative to canvas)
                let finalX, finalY; // coordinates w.r.t. canvas (0..canvasWidth/Height)
                if (containerCoords) {
                    // If we have a projected point (maybe offscreen), use its direction from center
                    const centerX = canvasWidth / 2;
                    const centerY = canvasHeight / 2;
                    const dx = canvasCoords.x - centerX;
                    const dy = canvasCoords.y - centerY;
                    const len = Math.sqrt(dx * dx + dy * dy);

                    // Apparent horizon radius calculation (keeps arrow at horizon when behind globe)
                    const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, Cesium.Cartesian3.ZERO);
                    const radius = ellipsoid.maximumRadius;
                    let theta = 0;
                    if (d > radius) {
                        theta = Math.asin(radius / d);
                    } else {
                        theta = Math.PI / 2;
                    }
                    const fovy = viewer.camera.frustum.fovy;
                    const pixelPerRad = canvasHeight / fovy;
                    const r = theta * pixelPerRad;

                    if (len > 1e-6) {
                        const nx = dx / len;
                        const ny = dy / len;
                        // horizon-centered
                        finalX = centerX + nx * r;
                        finalY = centerY + ny * r;
                    } else {
                        // directly center -> place arrow at top center
                        finalX = centerX;
                        finalY = centerY - r;
                    }

                    // If horizon position falls outside canvas (rare), clamp to canvas edge
                    if (finalX < 0) finalX = 0;
                    if (finalX > canvasWidth) finalX = canvasWidth;
                    if (finalY < 0) finalY = 0;
                    if (finalY > canvasHeight) finalY = canvasHeight;
                } else {
                    // no canvas coords at all (very rare) -> fallback to edge using bearing
                    const bearing = getBearingFromCameraToPoint(pos); // in camera space
                    const edgePos = getScreenEdgePosition(bearing, { width: canvasWidth, height: canvasHeight });
                    finalX = edgePos.x;
                    finalY = edgePos.y;
                }

                // Now clamp finalX/finalY to stay fully inside canvas, with margin
                const margin = Math.max(8, Math.round(arrowSizeNum / 2));
                if (finalX < margin) finalX = margin;
                if (finalX > canvasWidth - margin) finalX = canvasWidth - margin;
                if (finalY < margin) finalY = margin;
                if (finalY > canvasHeight - margin) finalY = canvasHeight - margin;

                // Compute rotation so arrow points *towards* the star's apparent canvas position (even if offscreen)
                // We'll compute a target point to point to: prefer canvasCoords if present, otherwise approximate by center + bearing*large
                let targetCanvasX, targetCanvasY;
                if (containerCoords) {
                    targetCanvasX = canvasCoords.x;
                    targetCanvasY = canvasCoords.y;
                } else {
                    // fallback target: center + vector from bearing
                    const bearing = getBearingFromCameraToPoint(pos);
                    const approx = getScreenEdgePosition(bearing, { width: canvasWidth, height: canvasHeight });
                    targetCanvasX = approx.x;
                    targetCanvasY = approx.y;
                }

                // Angle from arrow position to target (note: canvas Y grows downwards)
                const rotDx = targetCanvasX - finalX;
                const rotDy = targetCanvasY - finalY;
                let rotAngleDeg = Math.atan2(rotDy, rotDx) * 180 / Math.PI;
                // Keep in [0,360)
                if (!isFinite(rotAngleDeg)) rotAngleDeg = 0;

                // Position arrowDiv relative to container (container-left/top offsets)
                const leftInContainer = canvasOffsetLeft + finalX - arrowSizeNum / 2;
                const topInContainer = canvasOffsetTop + finalY - arrowSizeNum / 2;

                // Clamp to container box so arrow never leaves viewer.container
                const containerW = containerRect.width;
                const containerH = containerRect.height;
                let leftClamped = Math.max(0, Math.min(containerW - arrowSizeNum, leftInContainer));
                let topClamped = Math.max(0, Math.min(containerH - arrowSizeNum, topInContainer));

                entity.arrowDiv.style.left = leftClamped + 'px';
                entity.arrowDiv.style.top = topClamped + 'px';
                entity.arrowDiv.style.transform = `rotate(${rotAngleDeg}deg)`;
                entity.arrowDiv.style.display = 'block';
            }
        });

        // Label positioning: if activeEntity exists, attach popup either to star (if visible/on-canvas)
        // or to the arrow (center of arrowDiv)
        if (activeEntity) {
            const pos = activeEntity.position.getValue(Cesium.JulianDate.now());
            const isVisible = occluder.isPointVisible(pos);
            const canvasCoords = scene.cartesianToCanvasCoordinates(pos);

            // Prepare label content
            const labelHeader = document.getElementById('labelHeader');
            labelHeader.innerHTML = `${activeEntity.data.country}: ${activeEntity.data.city}`;

            const labelList = document.getElementById('labelList');
            labelList.innerHTML = "";
            activeEntity.data.marathons.forEach(m => {
                const li = document.createElement("li");
                li.innerHTML = `<b>${m.type}</b>: ${m.date}`;
                labelList.appendChild(li);
            });

            // Determine popup target position (relative to container)
            let popupX, popupY; // container coords
            let popupAnchorIsArrow = false;
            if (isVisible && canvasCoords && canvasCoords.x >= 0 && canvasCoords.x <= canvasRect.width && canvasCoords.y >= 0 && canvasCoords.y <= canvasRect.height) {
                // star visible on canvas -> attach to star
                popupX = canvasCoords.x + (canvasRect.left - containerRect.left);
                popupY = canvasCoords.y + (canvasRect.top - containerRect.top);
            } else {
                // attach to arrow center
                const arrowRect = activeEntity.arrowDiv.getBoundingClientRect();
                // arrowRect is relative to viewport; convert to container coordinates
                const containerRect2 = viewer.container.getBoundingClientRect();
                popupX = (arrowRect.left - containerRect2.left) + arrowRect.width / 2;
                popupY = (arrowRect.top - containerRect2.top) + arrowRect.height / 2;
                popupAnchorIsArrow = true;
            }

            // Position popup (keep inside container)
            const popup = label;
            const popupWidth = popup.offsetWidth;
            const popupHeight = popup.offsetHeight;
            const padding = 10;

            let x = popupX;
            let y = popupY;

            // Prefer to show popup slightly offset from the anchor (e.g. top-right of anchor)
            x += 12;
            y -= popupHeight / 2;

            // Clamp within container
            if (x + popupWidth > containerRect.width - padding) x = containerRect.width - popupWidth - padding;
            if (x < padding) x = padding;
            if (y + popupHeight > containerRect.height - padding) y = containerRect.height - popupHeight - padding;
            if (y < padding) y = padding;

            popup.style.left = x + 'px';
            popup.style.top = y + 'px';
            popup.style.display = 'block';
        } else {
            label.style.display = 'none';
        }
    });

    // Adjust sizes for device and handle resize
    function adjustForDevice() {
        const screenW = document.documentElement.clientWidth;
        const screenH = document.documentElement.clientHeight;

        // Determine star size and arrow size
        let starSize;
        if (isSmallScreen) {
            starSize = Math.round(Math.min(120, Math.max(32, screenW / 5)));
        } else {
            starSize = 40;
        }
        arrowSizeNum = isSmallScreen ? Math.round(Math.min(120, Math.max(32, screenW / 6))) : 40;

        points.forEach(entity => {
            entity.billboard.width = starSize;
            entity.billboard.height = starSize;

            entity.arrowDiv.style.width = arrowSizeNum + 'px';
            entity.arrowDiv.style.height = arrowSizeNum + 'px';
        });

        // UI label adjustments for very small screens
        const label = document.getElementById('uiLabel');
        if (isVerySmallScreen) {
            label.style.width = 'auto';
            label.style.minWidth = '287px';
            label.style.fontSize = '24px';
            label.style.padding = '12px 18px';
            closeBtn.style.padding = '8px 12px';
            closeBtn.style.marginLeft = '30px';
            closeBtn.style.fontSize = '24px';
        } else if (isSmallScreen) {
            label.style.width = 'auto';
            label.style.minWidth = '258px';
            label.style.fontSize = '20px';
            label.style.padding = '11px 16px';
            closeBtn.style.padding = '7px 11px';
            closeBtn.style.marginLeft = '27px';
            closeBtn.style.fontSize = '20px';
        } else {
            label.style.width = 'auto';
            label.style.minWidth = '229px';
            label.style.fontSize = '16px';
            label.style.padding = '9px 14px';
            closeBtn.style.padding = '6px 10px';
            closeBtn.style.marginLeft = '25px';
            closeBtn.style.fontSize = '16px';
        }
    }

    adjustForDevice();
    window.addEventListener('resize', adjustForDevice);
});
