import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import DashboardScreen from '../screens/DashboardScreen';
import TasksStack from './TasksStack';
import ProjectsStack from './ProjectsStack';
import KanbanStack from './KanbanStack';
import MoreStack from './MoreStack';
import { colors } from '../theme/theme';

const Tab = createBottomTabNavigator();

// Plain emoji icons for now rather than pulling in an icon font/package —
// zero extra native dependencies to link, easy to swap for
// @expo/vector-icons later without touching the navigation structure.
const ICONS = {
  Dashboard: '🏠',
  Tasks: '✅',
  Projects: '📁',
  Kanban: '📋',
  More: '☰',
};

export default function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // Dashboard keeps its own header (defined in RootNavigator's
        // screen options below); the other tabs each own a nested Stack
        // Navigator with its own headers, so the outer tab header would
        // just be a redundant second bar — hidden here.
        headerShown: route.name === 'Dashboard',
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: '700', color: colors.gray900 },
        tabBarActiveTintColor: colors.brand600,
        tabBarInactiveTintColor: colors.gray400,
        tabBarIcon: () => <Text style={{ fontSize: 20 }}>{ICONS[route.name]}</Text>,
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen name="Tasks" component={TasksStack} />
      <Tab.Screen name="Projects" component={ProjectsStack} />
      <Tab.Screen name="Kanban" component={KanbanStack} />
      <Tab.Screen name="More" component={MoreStack} />
    </Tab.Navigator>
  );
}
