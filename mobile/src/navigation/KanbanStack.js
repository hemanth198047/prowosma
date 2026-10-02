import { createNativeStackNavigator } from '@react-navigation/native-stack';
import KanbanScreen from '../screens/KanbanScreen';
import TaskDetailScreen from '../screens/TaskDetailScreen';
import { colors } from '../theme/theme';

const Stack = createNativeStackNavigator();

export default function KanbanStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontWeight: '700', color: colors.gray900 },
        headerTintColor: colors.brand600,
      }}
    >
      <Stack.Screen name="KanbanBoard" component={KanbanScreen} options={{ title: 'Kanban' }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
    </Stack.Navigator>
  );
}
