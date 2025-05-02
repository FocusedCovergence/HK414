const width = 800, height = 800;

// 1) 创建 SVG
const svg = d3.select("#map").append("svg")
    .attr("width", width)
    .attr("height", height);

// 2) 变量声明
let geoData, dengueData;

// 3) 颜色比例尺
const colorScale = d3.scaleSequential(d3.interpolateReds)
                    .domain([0, 500]);  // dengue 值大概在 0~500 之间



// const baseColors = d3.range(0, 10).map(i => d3.interpolateRainbow(i/10));

let currentIdx = 0;

let isPlaying = false;
let interval = null;

let subInterval = null;

const zoomTransforms = {};

let skipSmoothOnce = false;

// 4) 异步加载 GeoJSON + CSV
Promise.all([
    d3.json("data/brazil_microregions_simplified_v3.geojson"),
    d3.csv("data/composed_features.csv", d => {
        const parsed = {
            week_id: +d.week_id,
            micro_code: d.micro_code
        };

        for (const key in d) {
            if (key !== "week_id" && key !== "micro_code") {
                parsed[key] = +d[key];
            }
        }
        return parsed;
    })
]).then(([geo, data]) => {
    geoData = geo;
    dengueData = data;


    // 提取 feature 列表（除 week_id, micro_code）
    const allFeatures = Object.keys(data[0]).filter(k => k !== "week_id" && k !== "micro_code");

    const baseColors = d3.range(0, allFeatures.length).map(i => d3.interpolateRainbow(i / allFeatures.length));

    const featureScales = {};

    // color by number
    allFeatures.forEach((feature, i) => {
        // 1) 拿到这一列所有值并排序
        const vals = data.map(d => d[feature]).sort(d3.ascending);
        // 2) 取 4 个分界线（等分位数）
        const thresholds = [1,2,3,4].map(k => d3.quantile(vals, k / 5));
        // 3) 构造 domain，6 个点：min, t1, t2, t3, t4, max
        const domain = [ d3.min(vals), ...thresholds, d3.max(vals) ];
        // 4) 为每一段生成 6 色渐变，从白到基色
        const base = baseColors[i]; 
        const stops = d3.range(domain.length)
                        .map(j => d3.interpolateRgb("#fff", base)(j / (domain.length - 1)));
        // 5) 建立线性比例尺
        featureScales[feature] = d3.scaleLinear()
                                .domain(domain)
                                .range(stops);
    });

    // color by value
    // allFeatures.forEach((feature, i) => {
    //     const vals = data.map(d => d[feature]).filter(v => !isNaN(v));

    //     const min = d3.min(vals);
    //     const max = d3.max(vals);

    //     // 等间距划分成 5 段 → 共6个点
    //     const domain = d3.range(6).map(j => min + j * (max - min) / 5);

    //     // 基础色
    //     const base = baseColors[i];
    //     const stops = d3.range(6).map(j => d3.interpolateRgb("#fff", base)(j / 5));

    //     featureScales[feature] = d3.scaleLinear()
    //         .domain(domain)
    //         .range(stops);

    //     console.log(`Feature: ${feature}`);
    //     console.log(`Domain: [${domain.map(d => d.toFixed(2)).join(", ")}]`);
    // });

    window.featureScales = featureScales;

    // 创建 checkboxes
    const checkGroup = d3.select("#featureChecks");
    checkGroup.selectAll("label")
        .data(allFeatures)
        .enter()
        .append("label")
        .style("margin-right", "12px")
        .html(d => `<input type="checkbox" name="feature" value="${d}"> ${d}`);



    // 默认勾选 dengue
    d3.select(`#featureChecks input[value="dengue"]`).property("checked", true);


    // 设置滑块的最小/最大值
    const weeks = Array.from(new Set(data.map(d => d.week_id)))
                   .sort((a,b) => a - b);

    setupFeatureCheckboxListener(weeks, renderAllSelectedMaps);

    setupPlaybackControls(weeks, renderAllSelectedMaps);

    setupCustomProgressBar(weeks, renderAllSelectedMaps);

    // d3.select("#weekSlider")
    //     .attr("min", 0)
    //     .attr("max", weeks.length - 1)
    //     .attr("value", 0)
    //     .on("input", function() {
    //         const idx = +this.value;
    //         const realWeek = weeks[idx];
    //         d3.select("#weekLabel").text(realWeek);
    //         const selected = d3.selectAll("#featureChecks input")
    //                             .filter(function () { return this.checked; })
    //                             .nodes()
    //                             .map(n => n.value);

    //         renderAllSelectedMaps(selected, realWeek);
    //     });

    const yearWeekList = calculateWeek(weeks[0]);
    d3.select("#yearLabel").text(yearWeekList[0]);
    d3.select("#weekLabel").text(yearWeekList[1]);

    // d3.select("#weekLabel").text(weeks[0]);
    renderAllSelectedMaps(["dengue"], weeks[0]);

});


// function renderAllSelectedMaps(selectedFeatures, week) {
//     const container = d3.select("#map-container");
//     container.selectAll("*").remove();  // 清空所有旧图层

//     const currentData = Object.fromEntries(
//         dengueData.filter(d => d.week_id === week)
//                   .map(d => [d.micro_code, d])
//     );

//     selectedFeatures.forEach(feature => {
//         const mapDiv = container.append("div")
//             .attr("class", "vis-block")
//             .style("width", "calc(25% - 20px)")  // 每行最多 4 个
//             .style("min-width", "250px");

//         mapDiv.append("div")
//             .text(feature)
//             .style("font-weight", "bold")
//             .style("margin-bottom", "5px");

//         const svg = mapDiv.append("svg")
//             .attr("width", width)
//             .attr("height", height);

//         const g = svg.append("g");

//         svg.node().__feature__ = feature;

//         const zoomBehavior = makeZoomBehavior(feature, g);
//         svg.call(zoomBehavior);

//         if (zoomTransforms[feature]) {
//             svg.transition().duration(0).call(zoomBehavior.transform, zoomTransforms[feature]);
//         }

//         const projection = d3.geoMercator().fitSize([width, height], geoData);

//         // const projection = d3.geoMercator()
//         //                     .scale(180)
//         //                     .translate([width / 2, height / 1.8]);

//         const path = d3.geoPath().projection(projection);

//         // const color = d3.scaleSequential(d3.interpolateReds)
//         //     .domain([0, d3.max(Object.values(currentData).map(d => +d[feature])) || 1]);

//         // const color = featureScales[feature];
//         const color = window.featureScales[feature];

//         g.selectAll("path")
//             .data(geoData.features)
//             .enter()
//             .append("path")
//             .attr("d", path)
//             .attr("fill", d => {
//                 const code = d.properties.CD_MICRO;
//                 const val = currentData[code]?.[feature] || 0;
//                 return color(val);
//             })
//             .attr("stroke", "#999")
//             .attr("stroke-width", 0.5)
//             .attr("fill-opacity", 0.85);
//     });



// }


const mapGroups = {};  

function renderAllSelectedMaps(selectedFeatures, week, enableTrasition = false) {
    const container = d3.select("#map-container");

    Object.keys(mapGroups).forEach(feature => {
        if (!selectedFeatures.includes(feature)) {
            // 1) 从 DOM 上移除对应的 div
            container.select(`#map-${feature}`).remove();
            // 2) 删掉保存在 mapGroups 里的引用
            delete mapGroups[feature];
        }
    });
    // 构建当前周的数据查表
    const currentData = Object.fromEntries(
        dengueData
        .filter(d => d.week_id === week)
        .map(d => [d.micro_code, d])
    );

    selectedFeatures.forEach(feature => {
        // 1) 如果还没初始化这一张图，就建一次 DOM
        if (!mapGroups[feature]) {
            const mapDiv = container.append("div")
                .attr("id", `map-${feature}`)
                .attr("class", "vis-block")
                .style("flex", "1 1 calc(25% - 20px)")
                .style("max-width", "900px")
                .style("min-width", "250px");

            const featureName = abbFeatureName(feature)

            mapDiv.append("div")
                .text(featureName)
                .style("font-weight", "bold")
                .style("margin-bottom", "5px");

            const svg = mapDiv.append("svg")
                .attr("width", width)
                .attr("height", height);

            const g = svg.append("g");
            // 绑定 zoom 行为一次
            svg.call(makeZoomBehavior(feature, g));
            // 如果之前有保存的 transform，就恢复
            if (zoomTransforms[feature]) {
                svg.call(d3.zoom().transform, zoomTransforms[feature]);
            }

            // 创建 path（只做一次 enter）
            // const projection = d3.geoMercator()
            //                     .fitSize([width, height], geoData)
            //                     .translate([width/2 + 800, height/2-200]);
                                
            const projection = d3.geoMercator().fitSize([width, height], geoData);
            const pathGen = d3.geoPath().projection(projection);
            const paths = g.selectAll("path")
                .data(geoData.features, d => d.properties.CD_MICRO)
                .enter()
                .append("path")
                .attr("d", pathGen)
                .attr("stroke", "#999")
                .attr("stroke-width", 0.5)
                .attr("fill-opacity", 0.85)
                .classed("micro_region", true)
                .on("click", (event,d) => {
                    if (event.defaultPrevented) return;
                    console.log("Clicked:", d.properties.CD_MICRO);
                });

            // 记下来以便后面只更新 fill
            mapGroups[feature] = { g, paths };
        }

        // 2) 更新这张图的 fill
        const color = featureScales[feature];

        if(enableTrasition){
            mapGroups[feature].g.selectAll("path")
                        .transition()
                        .duration(500)
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            return color((currentData[code] || {})[feature] || 0);
                        });
        }else{
            mapGroups[feature].g.selectAll("path")
                        .attr("fill", d => {
                            const code = d.properties.CD_MICRO;
                            return color((currentData[code] || {})[feature] || 0);
                        });
        }

        // mapGroups[feature].g.selectAll("path")
        //                 .attr("fill", d => {
        //                     const code = d.properties.CD_MICRO;
        //                     return color((currentData[code] || {})[feature] || 0);
        //                 });
    });
}

function setupFeatureCheckboxListener(weeks, renderAllSelectedMaps) {
    d3.selectAll("#featureChecks input").on("change", function () {
        const selected = d3.selectAll("#featureChecks input")
            .filter(function () { return this.checked; })
            .nodes()
            .map(n => n.value);

        // const currentIdx = +d3.select("#weekSlider").property("value");
        const week = weeks[currentIdx];
        renderAllSelectedMaps(selected, week);
    });
}

function makeZoomBehavior(feature, g) {
    return d3.zoom()
        .scaleExtent([0.5, 8])
        .on("zoom", (event) => {
            g.attr("transform", event.transform);
            zoomTransforms[feature] = event.transform;
        });
}


function startAutoPlay(weeks, renderMapFn) {
    if (isPlaying) return;
    isPlaying = true;
    skipSmoothOnce = false;
    d3.select("#playButton").text("⏸");
    interval = setInterval(() => {
        const maxIdx = weeks.length - 1;
        const prevIdx = currentIdx;

        // currentIdx = (currentIdx + 1) > maxIdx ? 0 : currentIdx + 1;
        if (currentIdx < maxIdx) {
            currentIdx++;
        } else {
            // 已经到最后一帧 → 停止播放
            stopAutoPlay();
            return;   // 不再执行后续渲染
        }


        const realWeek = weeks[currentIdx];

        const yearWeekList = calculateWeek(realWeek);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);


        // d3.select("#weekLabel").text(realWeek);
        const selected = d3.selectAll("#featureChecks input")
                            .filter(function() { return this.checked; })
                            .nodes().map(n => n.value);
        renderMapFn(selected, realWeek, true);
        updateProgressBar(currentIdx, weeks.length);

        // tween
        clearInterval(subInterval);
        if (!skipSmoothOnce) {
        smoothAdvance(prevIdx, currentIdx, weeks);
        } else {
        skipSmoothOnce = false;
        }
    }, 1000);
}

function stopAutoPlay() {
    if (!isPlaying) return;
    clearInterval(interval);
    isPlaying = false;
    d3.select("#playButton").text("▶");
}


function setupPlaybackControls(weeks, renderMapFn) {
    // let isPlaying = false;
    // let interval = null;


    const playButton = d3.select("#playButton");
    playButton.on("click", () => {
        if (isPlaying) {
            stopAutoPlay();
        } else {
            if (currentIdx === weeks.length - 1) {
                currentIdx = 0;
                // 更新界面到第一帧
                // const firstWeek = weeks[0];

                const yearWeekList = calculateWeek(weeks[0]);
                d3.select("#yearLabel").text(yearWeekList[0]);
                d3.select("#weekLabel").text(yearWeekList[1]);


                // d3.select("#weekLabel").text(weeks[0]);
                updateProgressBar(0, weeks.length);
                const selected = d3.selectAll("#featureChecks input")
                                    .filter(function() { return this.checked; })
                                    .nodes().map(n => n.value);
                renderMapFn(selected, weeks[0]);
            }      
            startAutoPlay(weeks, renderMapFn);
        }
    });
}


function setupCustomProgressBar(weeks, renderMapFn) {
    const wrapper = d3.select("#progressBarWrapper");
    const fill = d3.select("#progressBarFill");

    let isDragging = false;
    let wasPlayingBeforeDrag = false;

    function updateFromX(x) {
        const rect = wrapper.node().getBoundingClientRect();
        const percent = Math.min(Math.max(x / rect.width, 0), 1);
        const idx = Math.round(percent * (weeks.length - 1));

        currentIdx = idx;

        const yearWeekList = calculateWeek(weeks[idx]);
        d3.select("#yearLabel").text(yearWeekList[0]);
        d3.select("#weekLabel").text(yearWeekList[1]);

        // d3.select("#weekLabel").text(weeks[idx]);

        const selected = d3.selectAll("#featureChecks input")
                            .filter(function () { return this.checked; })
                            .nodes()
                            .map(n => n.value);

        renderMapFn(selected, weeks[idx]);
        updateProgressBar(idx, weeks.length, true);
    }

    const dragger = d3.drag()
        .on("start", (event) => {
            // —— 这里放你所有“拖动开始要做的事” —— 
            clearInterval(subInterval);    // 停掉平滑补间
            wasPlayingBeforeDrag = isPlaying;
            if (isPlaying) {
                stopAutoPlay();
            }
            skipSmoothOnce = true;         // 如果你之前用过这个 flag
            d3.select("body").style("user-select", "none");
            updateFromX(event.x);
        })
        .on("drag", (event) => {
            // 一直拖到哪儿就去哪儿
            updateFromX(event.x);
        })
        .on("end", () => {
            d3.select("body").style("user-select", null);
            if (wasPlayingBeforeDrag) {
                // 恢复播放
                // skipSmoothOnce = true;
                // d3.select("#playButton").dispatch("click");
                startAutoPlay(weeks, renderMapFn);
            }
        });

    wrapper.call(dragger);
}

function updateProgressBar(currentIdx, total, immediate = false) {
    const progress = (currentIdx / (total - 1)) * 100;
    const bar = d3.select("#progressBarFill");

    if (immediate) {
        bar.style("transition", "none");
    } else {
        bar.style("transition", "width 0.3s linear");
    }

    bar.style("width", `${progress}%`);
}

function smoothAdvance(fromIdx, toIdx, weeks) {
    let frame = 0;
    const totalFrames = 30;  // 越大越平滑
    const start = fromIdx;
    const end = toIdx;

    clearInterval(subInterval);

    subInterval = setInterval(() => {
        frame++;
        const t = frame / totalFrames;
        const progress = start + (end - start) * t;

        updateProgressBar(progress, weeks.length);

        if (frame >= totalFrames) {
            clearInterval(subInterval);
        }
    }, 1000 / totalFrames);
}

function calculateWeek(passedWeek){
    let year = Math.floor(passedWeek/100);
    let week = passedWeek%100;
    return [year, week]
}

function abbFeatureName(name){
    const nameMap = {
        dengue: "Num of Dengue Cases",
        pressure: "Pressure",
        rainy_days: "Num Rainy Days",
        precipitation: "Precipitation",
        temperature_max: "Max Temperature",
        temperature_min: "Min Temperature",
        wind_speed: "Wind Speed",
        temperature_mean: "Temperature Avg",
        humidity: "Humidity",
        ndvi: "Normalized Difference Vegetation Index (NDVI)"
    };

    return nameMap[name] || "UNKNOWN";
}