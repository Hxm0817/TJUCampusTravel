var app4 = new Vue({
    el: '#app_mobile_iframe',
    data: {
        line: "L1",
        color: "",

        lastStationId: "-1",
        currentStationId: "-1",
        assertsPath: "./assets/",
        normalRadius: 6,
        selectedRadius: 8,
        favouredStation: "-1",

        busType: {
            "0": "公交",
            "1": "班车",
            "2": "直达"
        },
        direction: false,   //是否为上行, 默认为下行

        busSchedules: undefined,
        stations: new Map(),
        buss: new Map(),
        busPosition: new Map(),

        firstPos: 15,
        perSegment: 100,
        currentbusId: "-1",
        updatePeriod: 5000,
        firstId: 0,
        lastId: 0
    },

    created() {
        this.init();
        setInterval(() => {
            this.loadbuss();
            this.updateStationSchedule(this.currentStationId);
        }, 5000);
        setInterval(() => {
            if (this.currentbus !== "-1") {
                this.showbusInfo(this.currentbus);
            }
        }, 5000);
    },
    mounted() {
        window.reverseDirection = this.reverseDirection;
        window.switchLine = this.switchLine;
    },
    methods: {
        init() {
            let vm = this;
            window.addEventListener('message', function (e) {
                vm.load(e.data);
            });
        },

        showbusInfo(busId) {
            //关闭正在展示的详情
            if (this.currentbusId !== "-1") {
                this.buss.get(this.currentbusId).isShowDetail = false;
                this.$forceUpdate();
                console.log(busId === this.currentbusId);
                if (busId === this.currentbusId) {
                    this.currentbusId = "-1";
                    return;
                }
            }
            this.currentbusId = busId;
            let busData = this.buss.get(busId);

            busData.type = this.formatbusType(busData.level);
            busData.terminal = this.formatbusTerminal(busData).name;
            let terminalInfo = this.getbusDataOfStation("-1", busId);
            busData.terminalTime = myTime.formatTime(terminalInfo.arrivalTime);

            let nextInfo = this.getNextStationInfo(busId);
            console.log('下一站信息');
            console.log(nextInfo);
            busData.nextStop = this.stations.get(nextInfo.stationId.toString()).name;
            busData.arriveNextTime = nextInfo.arrivalTime;

            if (typeof (busData.isShowDetail) == "undefined" || !busData.isShowDetail) {
                busData.isShowDetail = true;
                this.$forceUpdate();
            }
        },

        //第一次加载
        load(line) {
            this.line = line;
            this.reset();
            const url = this.assertsPath + 'lineInfo/' + line + '.json'
            axios.get(url).then(res => {
                let names = res.data.stations
                let stationIds = res.data.stationIds
                this.firstId = stationIds[0]
                this.lastId = stationIds.slice(-1)[0]

                if (typeof (res.data.busType) != "undefined") {
                    this.busType = res.data.busType
                    console.log(this.busType)
                }
                this.direction = false;
                for (let i = 0; i < names.length; i++) {
                    this.stations.set(
                        stationIds[i] + "",
                        {
                            "stationId": stationIds[i],
                            "name": names[i],
                            "radius": 5,
                            "color": "#FFFFFF",
                            "strokeWidth": 0,
                            "buss": [],
                            "position": i,
                            "transferLines": res.data.transferInfo[stationIds[i] + ""]
                        }
                    );
                }
                this.color = res.data.color;
                this.initFavouredStation();

                // 加载列车车次
                this.loadbusSchedules(this.line).then(() => {
                    this.loadbuss();
                });
            }, () => {
                console.log('Load ' + url + ' Error!');
            });
        },

        async loadbusSchedules(line) {
            let url = this.assertsPath + 'timetable/' + line + '/'
            if (this.isWorkDay()) {
                url += line + '-workday' + '-bus-schedule.json'
            } else {
                url += line + '-restday' + '-bus-schedule.json'
            }
            await axios.get(url).then(res => {
                this.busSchedules = res.data;
            });
        },


        addbusPosition(position, busId) {
            position = position.toString();
            if (!this.busPosition.has(position)) {
                this.busPosition.set(position, [])
            }
            this.busPosition.get(position).push(busId);
        },

        getNowTime() {
            return new Date().format('HH:mm:ss')

        },

        loadbuss() {
            console.log('Loading buss...');
            //1.判断是否已加载所有列车的时刻表
            if (typeof (this.busSchedules) === "undefined") {
                console.log("列车时刻表未加载");
                return;
            }

            const scheduleArray = Object.values(this.busSchedules)

            let now = this.getNowTime();
            console.log('now:' + now);
            //当前在线运营的列车：符合 "始发站到达时间 <= 当前时间 <= 终点站离开时间" 条件的列车
            let onServicebuss = scheduleArray
                .filter(element => this.selectDirection(element.direction))
                .filter(element => now <= element.schedule[element.schedule.length - 1].departTime)
                .filter(element => now >= element.schedule[0].arrivalTime)
            console.log('当前在线列车:');
            console.log(onServicebuss);

            //记录在线运营列车的车次，用于删除this.buss中过时的列车
            let onServicebusNumbers = new Map();
            //更新this.busPosition
            this.busPosition.clear();
            //计算每列车的当前位置
            onServicebuss.forEach(bus => {
                onServicebusNumbers.set(bus.busId, '');
                bus.position = this.calcbusPosition(bus);
                bus.positionInView = this.calcbusPositionInView(bus.position);
                this.addbusPosition(bus.position, bus.busId)
                //把在运营的列车放入this.buss
                this.buss.set(bus.busId, bus)
            });
            console.log('当前列车位置');
            console.log(this.busPosition);
            //删除this.buss中在onServicebusNumbers没有的车次
            for (const busId of this.buss.keys()) {
                if (!onServicebusNumbers.has(busId)) {
                    console.log('busId' + '退出运营');
                    this.buss.delete(busId)
                }
            }

            //修改Map类型对象需要强制更新视图
            this.$forceUpdate();
            console.log('buss loaded.');
        },

        switchLine(line, loadStationId) {
            this.line = line;
            this.load(line).then(() => {
                // 加载列车车次
                this.loadbusSchedules(line).then(() => {
                    this.loadbuss()
                })

                if (typeof loadStationId == "undefined") {
                    this.initFavouredStation()
                    return
                }

                this.scrollToStation(loadStationId)
            })
        },

        initFavouredStation() {
            let station = cookie.getCookie(this.line);
            if (station === "") {
                this.favouredStation = "-1";
                return;
            }
            this.favouredStation = station;
            this.scrollToFavouredStation();
        },

        scrollToFavouredStation() {
            if (this.favouredStation === "-1") {
                return;
            }
            let stationId = this.favouredStation.toString();
            console.log('favoured:' + stationId)
            let position = this.getStationPosition(stationId)
            this.showStationInfo(stationId);
            this.$nextTick(() => {
                let scrollY = position * this.perSegment;
                window.scrollTo(0, scrollY);
            })
        },

        favourStation(stationId) {
            if (this.favouredStation === stationId) {
                this.favouredStation = "-1"
                cookie.setCookie(this.line, "", 90)
                return
            }
            this.favouredStation = stationId
            cookie.setCookie(this.line, stationId, 90)
        },

        resetStation() {
            this.lastStationId = "-1"
            this.currentStationId = "-1";
            this.stations.forEach((station) => {
                station.buss = [];
            });
        },

        reset() {
            this.resetStation();
            this.resetbuss();
            this.resetStationStyle();
        },

        resetbuss() {
            this.buss = new Map();
            this.currentbus = "-1";
            this.busPosition = new Map();
        },

        resetStationStyle() {
            if (this.lastStationId === "-1") {
                return;
            }
            this.stations.get(this.lastStationId).strokeWidth = 0;
            this.stations.get(this.lastStationId).radius = this.normalRadius;
        },

        //由父页面换向时调用, 实现本页面的切换上下行
        reverseDirection() {
            this.reset();

            this.direction = !this.direction;
            this.reverseStations();

            this.loadbuss();
            this.scrollToFavouredStation();
        },

        reverseStations() {
            this.stations = new Map(Array.from(this.stations).reverse());
            console.log(this.stations);
            this.$forceUpdate();
        },

        setStationStyle(stationId) {
            if (stationId.toString() === "-1") {
                return
            }
            this.resetStationStyle();
            stationId = stationId.toString()
            this.stations.get(stationId).radius = this.selectedRadius;
            this.stations.get(stationId).strokeWidth = 3;
        },

        showStationInfo(stationId) {
            this.lastStationId = this.currentStationId;
            this.setStationStyle(stationId);
            this.currentStationId = stationId;
            this.updateStationSchedule(stationId);
        },

        updateStationSchedule(stationId) {
            const TOTAL_DISPLAY_bus_NUMBER = 3
            stationId = stationId.toString()
            if (stationId === "-1") {
                return;
            }
            let busList = this.getLatestbuss(stationId, TOTAL_DISPLAY_bus_NUMBER);
            //暂无列车
            if (busList.length < TOTAL_DISPLAY_bus_NUMBER) {
                const futurebuss = this.getSchedulebuss(stationId).slice(0, TOTAL_DISPLAY_bus_NUMBER - busList.length)

                let busMap = new Map(busList.map(e => {
                    return [e.busId, e]
                }))
                futurebuss.forEach(e => {
                    if (!busMap.has(e.busId)) {
                        busMap.set(e.busId, e)
                    }
                })

                busList = Array.from(busMap.values())

                let t = {
                    "status": "停止服务",
                    "eta": "Out of service",
                    "terminal": "",
                    "description": ""
                }
                if (busList.length < 1) {
                    busList.push(t)
                }
            }
            //格式化数据
            busList.forEach(busData => {
                this.formatbusData(busData, stationId);
            });
            console.log(stationId + '站最近的列车');
            console.log(busList);


            this.stations.get(stationId.toString()).buss = busList;
        },

        formatbusData(busData, stationId) {
            if (typeof (busData.schedule) == "undefined") {
                return;
            }
            busData.status = this.formatbusStatus(busData);

            //判断是否为始发站
            const judgeFirstStop = (sid, tData) => {
                return Number(sid) === tData.schedule[0].stationId;
            }
            const isFirstStop = judgeFirstStop(stationId, busData)
            busData.eta = this.formatETA(busData, isFirstStop);

            busData.terminal = this.formatbusTerminal(busData).name;

            busData.description = this.formatbusDescription(busData, isFirstStop)
        },
        
        formatbusTerminal(busData) {
            let terminalId = busData.schedule.slice(-1)[0].stationId;
            return this.stations.get(terminalId.toString());
        },
        
        formatbusStatus(busData) {
            if (busData.arrivalTime === '......') {
                return '本站不停'
            }
            let now = this.getNowTime();
            if (now < busData.arrivalTime) {
                let d1 = new Date('2023/01/01 ' + now);
                let d2 = new Date('2023/01/01 ' + busData.arrivalTime);
                
                //当前时间和到达时间相差的秒数
                let difference = Math.ceil((d2 - d1) / 1000)
                if (difference <= 15) {
                    return '即将到站'
                } else {
                    let min = Math.ceil(difference / 60);
                    // if (min === 0) {
                    //     min = 1;
                    // }
                    return min + '分钟';
                }
            } else if (now >= busData.arrivalTime && now <= busData.departTime) {
                return '车已到站'
            } else if (now > busData.departTime) {
                return '车已过站'
            }
        },

        formatETA(busData, isFirstStop) {
            if (busData.arrivalTime === '......') {
                return 'No stop'
            }
            if (isFirstStop) {
                return myTime.formatTime(busData.departTime);
            }

            return myTime.formatTime(busData.arrivalTime);
        },

        formatbusDescription(busData, isFirstStop) {
            const busType = this.busType[busData.level.toString()]
            busData.description = ""
            if (isFirstStop) {
                busData.description = "始发"
            }
            if (busType.includes('直达')) {
                return busType
            }
            return busData.description
        },

        formatbusType(busLevel) {
            return this.busType[busLevel.toString()]
        },


        //获取id为stationId车站最近number次列车
        getLatestbuss(stationId, number) {
            let busList = [];
            const rawStationId = stationId;
            while (busList.length < number) {
                stationId = stationId.toString();
                console.log(stationId)
                if (this.busPosition.has(stationId)) {
                    const buss = this.busPosition.get(stationId);
                    buss.forEach(element => {
                        //element: busId
                        const busDataOfStation = this.getbusDataOfStation(rawStationId, element)
                        if (busDataOfStation !== undefined && busDataOfStation.arrivalTime !== '......') {
                            busList.push(busDataOfStation);
                        }
                    });
                }

                stationId = Number(stationId)
                stationId += this.direction ? 0.5 : -0.5

                if (stationId < this.firstId || stationId > this.lastId) {
                    //搜索完该站之前的列车即返回
                    break;
                }
            }
            busList.sort((obj1, obj2) => {
                return obj1.arrivalTime.localeCompare(obj2.arrivalTime)
            });

            //切片，busList长度小于等于number
            return busList.slice(0, number);
        },

        //获取busId次列车stationId站的时刻
        getbusDataOfStation(stationId, busId) {
            if (typeof (this.busSchedules[busId]) == "undefined") {
                console.log('没有' + busId + '班次的数据');
                return undefined
            }
            if (stationId === "-1") {
                //查询终点站
                return this.busSchedules[busId].schedule.slice(-1)[0];
            }

            //对象使用 = 赋值 修改引用会改变原对象
            let busData = Object.assign({}, this.busSchedules[busId]);
            return this.tobusDataOfStation(stationId, busData)
        },

        tobusDataOfStation(stationId, rawbusData) {
            const schedule = rawbusData.schedule.find(element => element.stationId === Number(stationId))
            if (schedule === undefined) {
                return
            }
            rawbusData.departTime = schedule.departTime;
            rawbusData.arrivalTime = schedule.arrivalTime;
            return rawbusData
        },

        isWorkDay() {
            let now = new Date();
            return !(now.getDay() === 0 || now.getDay() === 6);
        },

        //计算列车当前所在车站/区间
        calcbusPosition(bus) {
            let now = this.getNowTime();
            for (let i = 0; i < bus.schedule.length - 1; i++) {
                const departTime = bus.schedule[i].departTime
                const arrivalTime = bus.schedule[i].arrivalTime
                if (now >= arrivalTime && now <= departTime) {
                    //在当前站点
                    return bus.schedule[i].stationId;
                } else if (now > departTime && now < bus.schedule[i + 1].arrivalTime) {
                    //在当前站点与下一站之间
                    return (bus.schedule[i + 1].stationId + bus.schedule[i].stationId) / 2;
                }
            }
            //在终点站
            const terminalArrivalTime = bus.schedule[bus.schedule.length - 1].arrivalTime;
            const terminalDepartTime = bus.schedule[bus.schedule.length - 1].departTime;
            if (now >= terminalArrivalTime && now <= terminalDepartTime) {
                return bus.schedule[bus.schedule.length - 1].stationId;
            }
        },

        //计算列车在页面中的位置
        calcbusPositionInView(position) {
            // 上一站id(不一定是停车站,只是当前位置的上一站)
            const lastId = this.direction ? Math.ceil(position) : Math.floor(position)
            let p = this.getStationPosition(lastId)
            p = position !== lastId ? p + 0.5 : p
            return this.firstPos + p * this.perSegment
        },

        //基于在线运营列车查询列车下一站信息
        getNextStationInfo(busId) {
            if (!this.buss.get(busId)) {
                console.log(busId + '不在运营时间内');
            }
            let busData = Object.assign({}, this.buss.get(busId));
            let position = Number(busData.position);
            const route = busData.route.split('-')

            //查询根据当前位置下一站id
            const nextId = route.filter(element => {
                //过滤出id比当前位置大(下行)或小(上行)的站点, 其中第一个就是下一站id
                return this.direction ? Number(element) <= position : Number(element) >= position
            })[0]
            return busData.schedule.find(element => element.stationId === Number(nextId))
        },

        /**
         * 获取车站在页面的位置(上下行位置不同)
         *  @param stationId: 车站真实id Number|String
         *  @return number
         **/
        getStationPosition(stationId) {
            if (!this.stations.has(stationId.toString())) {
                console.log('获取stationId:' + stationId + '在页面中的位置失败, stations中没有该id')
                return undefined
            }
            const position = this.stations.get(stationId.toString()).position
            return this.direction ? this.stations.size - position - 1 : position
        },

        /**
         * 获取某站未来的列车
         * @param stationId
         */
        getSchedulebuss(stationId) {
            let buss = Array.from(this.preLoadbuss(stationId))
                .filter(element => {
                    return this.direction
                        ? element.schedule[0].stationId >= stationId
                        : element.schedule[0].stationId <= stationId
                })
                .sort((obj1, obj2) => {
                    return obj1.schedule[0].departTime.localeCompare(obj2.schedule[0].departTime)
                })
            buss.forEach(e => this.tobusDataOfStation(stationId, e))
            buss = buss.filter(e => e !== undefined)
            return Array.from(buss)
        },

        preLoadbuss() {
            if (this.busSchedules === undefined) {
                return
            }
            const scheduleArray = Object.values(this.busSchedules)
            return scheduleArray
                .filter(element => this.selectDirection(element.direction))
                .filter(element => this.selectTime(element.schedule[0].departTime, true))

        },

        //筛选出上/下行方向的列车
        selectDirection(num) {
            if (this.direction) {
                return num % 2 === 1
            } else {
                return num % 2 === 0
            }

        },

        //判断time是否在当前之间之前或之后
        selectTime(time, isLatter) {
            let now = this.getNowTime();
            return isLatter ? time >= now : time < now
            
        }
    }
})