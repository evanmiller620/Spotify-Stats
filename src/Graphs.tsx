import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CanvasJSChart } from 'canvasjs-react-charts';
import './Graphs.css';

// Track interface
interface SpotifyTrack {
    song: string;
    artist: string;
    album: string;
    playCount: number;
    skipCount: number;
    avgSkipTime: number;
    duration: number;
}

export default function SpotifyStatsVisualizer() {
    // Track data
    const [tracks, setTracks] = useState<SpotifyTrack[]>([]);

    // Period data (months or years)
    const [periodData, setPeriodData] = useState<{ [key: string]: SpotifyTrack[] }>({});
    const [chartData, setChartData] = useState<{ period: string; value: number }[]>([]);

    // UI state
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [viewType, setViewType] = useState<'month' | 'year'>('month');
    const [chosenYear, setChosenYear] = useState<string>("2025");
    const [metric, setMetric] = useState<'plays' | 'duration' | 'skips'>('plays');
    const [years, setYears] = useState<string[]>([]);
    // Chart dimensions
    const [chartDimensions, setChartDimensions] = useState({ width: 100, height: 400 });
    const chartContainerRef = useRef<HTMLDivElement>(null);

    // Handle resize
    useEffect(() => {
        const updateDimensions = () => {
            if (chartContainerRef.current) {
                setChartDimensions({
                    width: chartContainerRef.current.clientWidth || 0,
                    height: 400
                });
            }
        };
        updateDimensions();
        window.addEventListener('resize', updateDimensions);
        return () => {
            window.removeEventListener('resize', updateDimensions);
        };
    }, []);

    // set up the year dropdown
    useEffect(() => {
        const fetchYears = async () => {
            try {
                const periodsResponse = await fetch('/spotify_data_dated/month_data/index.json');
                if (!periodsResponse.ok) throw new Error('Failed to fetch available periods');
    
                const periodsData = await periodsResponse.json();
                const periods = periodsData.periods || [];
                setYears(Array.from(new Set(periods.map((period: string) => period.split('-')[0]))));
            } catch (error) {
                console.error('Error fetching years:', error);
            }
        };
    
        fetchYears();
    }, []);

    // Load period data when viewType changes
    useEffect(() => {
        const fetchPeriodData = async () => {
            setIsLoading(true);
            setPeriodData({});
            setError(null);

            try {
                // First, fetch the list of available periods
                const periodsResponse = await fetch(
                    viewType === 'month'
                        ? '/spotify_data_dated/month_data/index.json'
                        : '/spotify_data_dated/year_data/index.json'
                );

                if (!periodsResponse.ok) throw new Error('Failed to fetch available periods');

                const periodsData = await periodsResponse.json();
                var periods = periodsData.periods || [];
                if (viewType === 'month') {
                    periods = periods.filter((period: string) => period.includes(chosenYear));
                }

                // Now fetch data for each period
                const periodDataMap: { [key: string]: SpotifyTrack[] } = {};

                for (const period of periods) {
                    const periodResponse = await fetch(
                        viewType === 'month'
                            ? `/spotify_data_dated/month_data/${period}.json`
                            : `/spotify_data_dated/year_data/${period}.json`
                    );

                    if (!periodResponse.ok) {
                        console.warn(`Failed to fetch data for ${period}`);
                        continue;
                    }

                    const periodTracks = await periodResponse.json();
                    periodDataMap[period] = periodTracks;
                }
                setPeriodData(periodDataMap);
            } catch (error) {
                console.error('Error fetching period data:', error);
                setError(`Failed to load ${viewType} data. Please try again later.`);
            } finally {
                setIsLoading(false);
            }
        };

        fetchPeriodData();
    }, [viewType, chosenYear]);

    // Prepare chart data based on selected view and metric
    useEffect(() => {
        const data = Object.entries(periodData).map(([period, tracks]) => {
            let value;
            switch (metric) {
                case 'plays':
                    value = tracks.reduce((sum, track) => sum + track.playCount, 0);
                    break;
                case 'duration':
                    // Convert seconds to minutes for better visualization
                    value = tracks.reduce((sum, track) => sum + track.duration, 0);
                    break;
                case 'skips':
                    value = tracks.reduce((sum, track) => sum + track.skipCount, 0);
                    break;
            }
            return {
                period,
                value: Math.round(value * 100) / 100
            };
        }).sort((a, b) => a.period.localeCompare(b.period));
        setChartData(data);
    }, [periodData, metric]);

    // Format tooltip values
    const formatTooltipValue = (value: number) => {
        switch (metric) {
            case 'plays':
                return `${value.toLocaleString()} plays`;
            case 'duration':
                if (value > 24 * 3600) {
                    const days = Math.floor(value / (24 * 3600));
                    const hours = Math.floor((value % (24 * 3600)) / 3600);
                    const minutes = Math.round((value % 3600) / 60);
                    return `${days} days ${hours} hr ${minutes} min`;
                }
                if (value > 3600) {
                    const hours = Math.floor(value / 3600);
                    const minutes = Math.round((value / 60) % 60);
                    return `${hours} hr ${minutes} min`;
                }
                return `${Math.round(value)} minutes`;
            case 'skips':
                return `${value.toLocaleString()} skips`;
        }
    };

    // Format labels for display
    const formatPeriodLabel = (period: string) => {
        if (viewType === 'month') {
            const [year, month] = period.split('-');
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${monthNames[parseInt(month) - 1]} ${year}`;
        }
        return period;
    };

    // Get y-axis label based on metric
    const getYAxisLabel = () => {
        switch (metric) {
            case 'plays':
                return 'Total Play Count';
            case 'duration':
                return 'Total Listening Time (min)';
            case 'skips':
                return 'Total Skip Count';
        }
    };

    // Generate bar color based on metric
    const getBarColor = () => {
        switch (metric) {
            case 'plays':
                return '#1DB954'; // Spotify green
            case 'duration':
                return '#4A90E2'; // Blue
            case 'skips':
                return '#E91E63'; // Pink
        }
    };

    // Calculate additional stats
    const stats = useMemo(() => {
        if (chartData.length === 0) {
            return null;
        }

        // Find period with max value
        let maxPeriod = chartData[0].period;
        let maxValue = chartData[0].value;
        let totalValue = 0;

        chartData.forEach(item => {
            totalValue += item.value;

            if (item.value > maxValue) {
                maxValue = item.value;
                maxPeriod = item.period;
            }
        });

        const avgValue = chartData.length > 0 ? totalValue / chartData.length : 0;

        return {
            maxPeriod,
            maxValue,
            avgValue,
            totalValue
        };
    }, [chartData]);

    if (error) {
        return (
            <div>
                <div className="text-lg font-medium text-red-400">{error}</div>
            </div>
        );
    }
    return (
        <div className="flex flex-col p-6 bg-gray-900 rounded-lg">
            <div className="flex flex-row">
                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
                    <div className="flex items-center bg-gray-800 rounded-lg shadow p-2">
                        <span className="text-gray-300 mr-2">View</span>
                        <div className="flex bg-gray-700">
                            <select
                                className={`px-4 py-2 bg-gray-700 text-gray-300 rounded-md transition-colors hover:bg-gray-600 disabled:opacity-50`}
                                onChange={(e) => {setChosenYear(e.target.value as any); setViewType('month')}}
                                disabled={isLoading}
                                value={chosenYear}
                            >
                                {years.map((year) => (
                                    <option key={year} value={year}>
                                        {year}
                                    </option>
                                ))}
                            </select>
                            <button
                                className={`px-4 py-2 transition-colors ${viewType === 'year'
                                    ? 'bg-green-600'
                                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                onClick={() => setViewType('year')}
                                disabled={isLoading}
                            >
                                Yearly
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center bg-gray-800 rounded-lg shadow p-2">
                        <span className="text-gray-300 mr-2">Metric:</span>
                        <select
                            className="bg-gray-700 rounded-md px-3 py-2 appearance-none text-gray-300 hover:bg-gray-600 border-0"
                            value={metric}
                            onChange={(e) => setMetric(e.target.value as any)}
                            disabled={isLoading}
                        >
                            <option value="plays">Play Count</option>
                            <option value="duration">Listening Time</option>
                            <option value="skips">Skip Count</option>
                        </select>
                    </div>
                    {stats && (
                        <div className="bg-gray-800 rounded-lg shadow p-4">
                            <div className="text-sm text-gray-400">
                                Highest {metric === 'plays' ? 'Play Count' : metric === 'duration' ? 'Listening Time' : 'Skip Count'}
                            </div>
                            <div className="text-xl font-bold mt-1 text-green-400">
                                {formatTooltipValue(stats.maxValue)}
                            </div>
                            <div className="text-sm text-gray-400 mt-1">
                                in {formatPeriodLabel(stats.maxPeriod)}
                            </div>
                        </div>
                    )}
                    {stats && (
                        <div className="bg-gray-800 rounded-lg shadow p-4">
                            <div className="text-sm text-gray-400">Average per {viewType}</div>
                            <div className="text-xl font-bold mt-1 text-green-400">
                                {formatTooltipValue(stats.avgValue)}
                            </div>
                        </div>
                    )}
                    {stats && (
                        <div className="bg-gray-800 rounded-lg shadow p-4">
                            <div className="text-sm text-gray-400">
                                Total {metric === 'plays' ? 'Play Count' : metric === 'duration' ? 'Listening Time' : 'Skips'}
                            </div>
                            <div className="text-xl font-bold mt-1 text-green-400">
                                {formatTooltipValue(stats.totalValue)}
                            </div>
                        </div>
                    )}
                </div>

            </div>

            <div className="w-full">
                {chartDimensions.width > 0 && (
                    <CanvasJSChart
                        options={{
                            animationEnabled: true,
                            theme: "dark2",
                            title: {
                                text: ""
                            },
                            axisX: {
                                title: "Period",
                                interval: viewType === 'month' && chartData.length > 12 ? 1 : 0
                            },
                            axisY: {
                                title: getYAxisLabel(),
                                includeZero: true
                            },
                            data: [{
                                type: "column",
                                color: getBarColor(),
                                dataPoints: chartData.map(data => ({
                                    label: formatPeriodLabel(data.period),
                                    y: data.value
                                }))
                            }]
                        }}
                    />
                )}
            </div>

            <div className="mt-6 text-sm text-gray-400">
                {metric === 'duration' && <p>Note: Duration is shown in minutes for easier visualization</p>}
                <p className="mt-1">Showing data for {chartData.length} {viewType === 'month' ? 'months' : 'years'}</p>
            </div>
        </div>
    );

}