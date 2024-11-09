// import React, { useState, useEffect } from 'react';
// import {
//   BarChart,
//   Bar,
//   XAxis,
//   YAxis,
//   CartesianGrid,
//   Tooltip,
//   Legend,
//   ResponsiveContainer,
//   PieChart,
//   Pie,
//   Cell,
//   LineChart,
//   Line
// } from 'recharts';

// const COLORS = ['#1aa34a', '#1db954', '#1ed760', '#2ee26a', '#3eeb74'];

// const Graphs = () => {
//   const [tracks, setTracks] = useState([]);
//   const [activeTab, setActiveTab] = useState('artists');
//   const [topArtists, setTopArtists] = useState([]);
//   const [skipData, setSkipData] = useState([]);
//   const [durationDistribution, setDurationDistribution] = useState([]);

//   useEffect(() => {
//     const fetchData = async () => {
//       try {
//         const localData = localStorage.getItem('spotifyTracks');
        
//         if (localData) {
//           const jsonData = JSON.parse(localData);
//           processData(jsonData.data);
//         } else {
//           const response = await fetch('/spotify_stats.json');
//           if (!response.ok) throw new Error('Network response was not ok');
          
//           const jsonData = await response.json();
//           processData(jsonData.data);
          
//           localStorage.setItem('spotifyTracks', JSON.stringify(jsonData));
//         }
//       } catch (error) {
//         console.error('Error fetching data:', error);
//       }
//     };

//     fetchData();
//   }, []);

// const processData = (data: any) => {
//     setTracks(data);

//     // Process top artists
//     const artistStats = data.reduce((acc: any, track: any) => {
//       acc[track.artist] = (acc[track.artist] || 0) + track.playCount;
//       return acc;
//     }, {});

//     const sortedArtists = Object.entries(artistStats)
//       .map(([artist, plays]) => ({ artist, plays }))
//       .sort((a, b) => b.plays - a.plays)
//       .slice(0, 5);

//     setTopArtists(sortedArtists);

    

//     // Process skip data
//     const skipStats = data.map(track => ({
//       name: track.song,
//       skipRate: ((track.skipCount / track.playCount) * 100).toFixed(2),
//       avgSkipTime: track.avgSkipTime
//     }))
//     .sort((a, b) => b.skipRate - a.skipRate)
//     .slice(0, 10);

//     setSkipData(skipStats);

//     // Process duration distribution
//     const durationRanges = {
//       '0-2min': 0,
//       '2-3min': 0,
//       '3-4min': 0,
//       '4-5min': 0,
//       '5min+': 0
//     };

//     data.forEach(track => {
//       const minutes = track.duration / 60;
//       if (minutes <= 2) durationRanges['0-2min']++;
//       else if (minutes <= 3) durationRanges['2-3min']++;
//       else if (minutes <= 4) durationRanges['3-4min']++;
//       else if (minutes <= 5) durationRanges['4-5min']++;
//       else durationRanges['5min+']++;
//     });

//     setDurationDistribution(
//       Object.entries(durationRanges).map(([range, count]) => ({
//         range,
//         count
//       }))
//     );
//   };

//   const renderContent = () => {
//     switch (activeTab) {
//       case 'artists':
//         return (
//           <div className="bg-white rounded-lg shadow-sm p-6">
//             <h2 className="text-2xl font-semibold mb-4">Most Played Artists</h2>
//             <div className="h-96">
//               <ResponsiveContainer width="100%" height="100%">
//                 <BarChart data={topArtists}>
//                   <CartesianGrid strokeDasharray="3 3" />
//                   <XAxis dataKey="artist" />
//                   <YAxis />
//                   <Tooltip />
//                   <Legend />
//                   <Bar dataKey="plays" fill="#1aa34a" />
//                 </BarChart>
//               </ResponsiveContainer>
//             </div>
//           </div>
//         );

//       case 'skips':
//         return (
//           <div className="bg-white rounded-lg shadow-sm p-6">
//             <h2 className="text-2xl font-semibold mb-4">Skip Analysis</h2>
//             <div className="h-96">
//               <ResponsiveContainer width="100%" height="100%">
//                 <LineChart data={skipData}>
//                   <CartesianGrid strokeDasharray="3 3" />
//                   <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
//                   <YAxis />
//                   <Tooltip />
//                   <Legend />
//                   <Line type="monotone" dataKey="skipRate" stroke="#1aa34a" name="Skip Rate (%)" />
//                   <Line type="monotone" dataKey="avgSkipTime" stroke="#1ed760" name="Avg Skip Time (s)" />
//                 </LineChart>
//               </ResponsiveContainer>
//             </div>
//           </div>
//         );

//       case 'duration':
//         return (
//           <div className="bg-white rounded-lg shadow-sm p-6">
//             <h2 className="text-2xl font-semibold mb-4">Song Duration Distribution</h2>
//             <div className="h-96">
//               <ResponsiveContainer width="100%" height="100%">
//                 <PieChart>
//                   <Pie
//                     data={durationDistribution}
//                     dataKey="count"
//                     nameKey="range"
//                     cx="50%"
//                     cy="50%"
//                     outerRadius={150}
//                     label
//                   >
//                     {durationDistribution.map((entry, index) => (
//                       <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
//                     ))}
//                   </Pie>
//                   <Tooltip />
//                   <Legend />
//                 </PieChart>
//               </ResponsiveContainer>
//             </div>
//           </div>
//         );

//       default:
//         return null;
//     }
//   };

//   return (
//     <div className="p-6 max-w-6xl mx-auto">
//       <div className="flex bg-gray-100 p-1 rounded-lg mb-8 gap-1">
//         {['artists', 'skips', 'duration'].map((tab) => (
//           <button
//             key={tab}
//             onClick={() => setActiveTab(tab)}
//             className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition-colors
//               ${activeTab === tab 
//                 ? 'bg-white text-green-600 shadow-sm' 
//                 : 'text-gray-600 hover:text-green-600'
//               }`}
//           >
//             {tab.charAt(0).toUpperCase() + tab.slice(1)}
//           </button>
//         ))}
//       </div>
//       {renderContent()}
//     </div>
//   );
// };

// export default Graphs;
export {}